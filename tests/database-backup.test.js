const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { gunzipSync } = require('node:zlib');
const { createDatabaseBackup, connectionOptions } = require('../services/databaseBackup');
const env = { DB_HOST: '127.0.0.1', DB_USER: 'test-backup', DB_PASSWORD: 'test-secret-"\\\npassword', DB_NAME: 'test_goride', DB_PORT: '3306' };
const sql = '-- Test SQL export\nCREATE TABLE sample (id INT);\nINSERT INTO sample VALUES (1);\n';
async function fixture(t, { engines = ['InnoDB'], script = `process.stdout.write(${JSON.stringify(sql)});`, maxBytes, toolMissing = false } = {}) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'goride-backup-test-')); t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
    const state = { args: [], released: 0, unlocked: 0, locked: false, spawned: 0 };
    const pool = {
        query: async () => [engines.map(engine => ({ engine }))],
        getConnection: async () => ({ async query(query) {
            if (query.includes('GET_LOCK')) { if (state.locked) return [[{ acquired: 0 }]]; state.locked = true; return [[{ acquired: 1 }]]; }
            state.unlocked++; state.locked = false; return [[{}]];
        }, release() { state.released++; } }),
    };
    const service = createDatabaseBackup({ pool, env, tempRoot, maxBytes, execFileImpl: async () => { if (toolMissing) throw new Error('missing utility'); return { stdout: 'mysqldump Ver 8.0.44 for Linux' }; }, spawnImpl: (_, args) => {
        state.args = args; state.spawned++;
        const configPath = args[0].slice('--defaults-file='.length);
        state.config = fsSync.readFileSync(configPath, 'utf8'); state.configMode = fsSync.statSync(configPath).mode & 0o777;
        return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    } });
    return { state, service, tempRoot };
}
test('whole database backup creates a private gzip with objects and no password in command arguments', async t => {
    const f = await fixture(t); const result = await f.service.generate();
    assert.equal(gunzipSync(await fs.readFile(result.filePath)).toString(), sql); assert.equal((await fs.stat(result.filePath)).mode & 0o777, 0o600); assert.equal(f.state.configMode, 0o600);
    for (const option of ['--routines', '--events', '--triggers', '--hex-blob', '--single-transaction', '--skip-lock-tables', '--column-statistics=0', '--databases', 'test_goride']) assert.ok(f.state.args.includes(option));
    assert.ok(!f.state.args.join(' ').includes(env.DB_PASSWORD)); assert.match(f.state.config, /password=/); assert.equal(f.state.unlocked, 1);
    assert.match(result.filename, /PKT\.sql\.gz$/); await result.cleanup(); assert.deepEqual(await fs.readdir(f.tempRoot), []);
});
test('mixed engines use a consistent read lock only while generating the file', async t => {
    const f = await fixture(t, { engines: ['InnoDB', 'MyISAM'] }); const status = await f.service.status(); assert.equal(status.snapshot_mode, 'read_lock');
    const result = await f.service.generate(); assert.ok(f.state.args.includes('--lock-all-tables')); assert.ok(!f.state.args.includes('--single-transaction')); assert.equal(f.state.locked, false); await result.cleanup();
});
test('failed dump exits do not return a partial archive or disclose stderr credentials', async t => {
    const f = await fixture(t, { script: `process.stderr.write('private database details and credentials'); process.stdout.write('partial'); process.exitCode=2;` });
    await assert.rejects(f.service.generate(), error => error.status === 503 && !/private database/.test(error.message));
    assert.deepEqual(await fs.readdir(f.tempRoot), []); assert.equal(f.state.unlocked, 1);
});
test('missing dump utility reports setup instructions; empty successful exports are rejected', async t => {
    const f = await fixture(t, { toolMissing: true }); assert.equal((await f.service.status()).available, false); await assert.rejects(f.service.generate(), { status: 503 }); assert.equal(f.state.spawned, 0);
    const empty = await fixture(t, { script: '' }); await assert.rejects(empty.service.generate(), { status: 503 }); assert.deepEqual(await fs.readdir(empty.tempRoot), []);
});
test('backup cancellation and compressed-size limits kill the job and remove private files', async t => {
    const f = await fixture(t, { script: "process.stdout.write('partial');setTimeout(()=>{},10000);" }); const controller = new AbortController(); const pending = f.service.generate({ signal: controller.signal });
    setTimeout(() => controller.abort(), 100); await assert.rejects(pending, { status: 499 }); assert.deepEqual(await fs.readdir(f.tempRoot), []);
    const limited = await fixture(t, { maxBytes: 1 }); await assert.rejects(limited.service.generate(), { status: 413 }); assert.equal(limited.state.unlocked, 1); assert.deepEqual(await fs.readdir(limited.tempRoot), []);
});
test('parallel requests cannot launch duplicate database exports', async t => {
    const f = await fixture(t, { script: `process.stdout.write(${JSON.stringify(sql)});setTimeout(()=>{},150);` }); const first = f.service.generate(); await assert.rejects(f.service.generate(), { status: 409 }); const result = await first; await result.cleanup(); assert.equal(f.state.spawned, 1);
});
test('dump option file escapes credentials and database names cannot become command flags', () => {
    const config = connectionOptions(env); assert.match(config, /\\"/); assert.match(config, /\\n/);
    for (const DB_NAME of ['--all-databases', 'x; rm -rf', '../database', 'x\npassword=bad']) assert.throws(() => connectionOptions({ ...env, DB_NAME }), { status: 503 });
});
