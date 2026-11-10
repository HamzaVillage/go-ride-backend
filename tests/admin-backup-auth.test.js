const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createAdminRouter } = require('../routers/admin');
function configure(t) {
    const oldSecret = process.env.JWT_SECRET, oldAccess = process.env.EMPLOYEE_ACCESS_ENABLED;
    process.env.JWT_SECRET = 'backup-http-test-secret'; process.env.EMPLOYEE_ACCESS_ENABLED = 'true';
    t.after(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; if (oldAccess === undefined) delete process.env.EMPLOYEE_ACCESS_ENABLED; else process.env.EMPLOYEE_ACCESS_ENABLED = oldAccess; });
}
async function fixture(t, { employee = false, inactive = false } = {}) {
    configure(t); let generated = 0, cleaned = 0;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'goride-backup-http-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'fixture.sql.gz'); await fs.writeFile(filePath, gzipSync('CREATE TABLE fixture (id INT);'));
    const conn = { release() {}, async query(sql) {
        if (sql.includes('FROM users')) return [[{ User_ID_Pk: 7, Role: employee ? 'employee' : 'admin' }]];
        if (sql.includes('FROM employee WHERE user_id')) return [employee ? [{ emp_id: 8, is_active: inactive ? 0 : 1, is_deleted: 0 }] : []];
        if (sql.includes('SELECT DISTINCT')) return [[{ function_code: 'settings' }]];
        throw new Error('Unexpected SQL');
    } };
    const pool = { getConnection: async () => conn, query: sql => conn.query(sql) };
    const backup = { status: async () => ({ available: true, snapshot_mode: 'transaction' }), async generate() { generated++; return { filePath, filename: 'fixture.sql.gz', size: (await fs.stat(filePath)).size, snapshot_mode: 'transaction', cleanup: async () => { cleaned++; } }; } };
    const app = express(); app.use(express.json()); app.use('/admin', createAdminRouter(pool, { backup }));
    const server = app.listen(0, '127.0.0.1'); t.after(() => new Promise(resolve => server.close(resolve))); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`; const token = jwt.sign({ userId: 7, role: employee ? 'employee' : 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return { origin, token, generated: () => generated, cleaned: () => cleaned };
}
test('settings permission does not allow an employee to download the entire database', async t => {
    const f = await fixture(t, { employee: true });
    for (const [suffix, method] of [['/backup/status', 'GET'], ['/backup', 'POST']]) { const response = await fetch(f.origin + '/admin/settings' + suffix, { method, headers: { Authorization: `Bearer ${f.token}` } }); assert.equal(response.status, 403); }
    assert.equal(f.generated(), 0);
});
test('inactive employee and unsigned requests cannot invoke backup generation', async t => {
    const f = await fixture(t, { employee: true, inactive: true });
    for (const token of ['', f.token]) { const response = await fetch(f.origin + '/admin/settings/backup', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); assert.equal(response.status, 401); }
    assert.equal(f.generated(), 0);
});
test('bootstrap admin receives a no-store gzip attachment and temporary export is cleaned', async t => {
    const f = await fixture(t); const response = await fetch(f.origin + '/admin/settings/backup', { method: 'POST', headers: { Authorization: `Bearer ${f.token}` } });
    assert.equal(response.status, 200); assert.match(response.headers.get('access-control-expose-headers'), /Content-Disposition/); assert.match(response.headers.get('cache-control'), /no-store/); assert.match(response.headers.get('content-disposition'), /attachment; filename="fixture.sql.gz"/);
    const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(gunzipSync(bytes).toString(), 'CREATE TABLE fixture (id INT);');
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.cleaned(), 1); assert.equal(f.generated(), 1);
});
