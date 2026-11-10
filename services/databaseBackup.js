const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { createGzip } = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const { fail } = require('./employeeAccess');
const runFile = promisify(execFile);
const quoteOption = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
function connectionOptions(env) {
    if (!env.DB_HOST || !env.DB_USER || !/^[a-zA-Z0-9_][a-zA-Z0-9_$-]{0,63}$/.test(env.DB_NAME || '')) throw fail(503, 'Database backup connection is not configured.');
    const port = Number(env.DB_PORT || 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail(503, 'Database backup port is not configured correctly.');
    return `[client]\nhost=${quoteOption(env.DB_HOST)}\nuser=${quoteOption(env.DB_USER)}\npassword=${quoteOption(env.DB_PASSWORD || '')}\nport=${port}\nprotocol=tcp\ndefault-character-set=utf8mb4\n`;
}
function createDatabaseBackup({ pool, env = process.env, spawnImpl = spawn, execFileImpl = runFile, tempRoot = os.tmpdir(), maxBytes = 5 * 1024 ** 3 } = {}) {
    let busy = false;
    async function clientInfo() {
        try {
            const { stdout } = await execFileImpl(env.MYSQLDUMP_PATH || 'mysqldump', ['--version'], { timeout: 3000, maxBuffer: 4096, windowsHide: true });
            return { mariaDB: /mariadb/i.test(stdout), mysql8: !/mariadb/i.test(stdout) && /(?:Ver|Distrib)\s+(?:8\.|9\.)/i.test(stdout) };
        } catch { throw fail(503, 'Install mysqldump (or mariadb-dump) on the API server and configure MYSQLDUMP_PATH.'); }
    }
    async function databaseInfo() {
        const [engines] = await pool.query("SELECT DISTINCT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
        return { transactional: engines.length > 0 && engines.every(row => String(row.engine).toLowerCase() === 'innodb') };
    }
    return {
        async status() {
            try { connectionOptions(env); await clientInfo(); const info = await databaseInfo(); return { available: true, busy, snapshot_mode: info.transactional ? 'transaction' : 'read_lock', format: 'sql.gz' }; }
            catch (error) { if (error.status) return { available: false, busy, message: error.message }; throw error; }
        },
        async generate({ signal } = {}) {
            if (busy) throw fail(409, 'A database backup is already being prepared. Please try again after it finishes.');
            busy = true;
            let directory, child, timer, lockConn;
            const abort = () => { child?.kill('SIGTERM'); setTimeout(() => child?.kill('SIGKILL'), 1000).unref(); };
            try {
                const options = connectionOptions(env), client = await clientInfo();
                lockConn = await pool.getConnection();
                const [locks] = await lockConn.query("SELECT GET_LOCK(CONCAT('goride_backup_', LEFT(SHA2(DATABASE(),256),40)), 0) AS acquired");
                if (Number(locks[0]?.acquired) !== 1) throw fail(409, 'A database backup is already being prepared.');
                const info = await databaseInfo();
                if (signal?.aborted) throw fail(499, 'Backup cancelled.');
                directory = await fs.mkdtemp(path.join(tempRoot, 'goride-backup-'));
                const configPath = path.join(directory, 'client.cnf'), filePath = path.join(directory, 'database.sql.gz');
                await fs.writeFile(configPath, options, { mode: 0o600, flag: 'wx' });
                const args = [`--defaults-file=${configPath}`, '--quick', '--hex-blob', '--routines', '--events', '--triggers', '--no-tablespaces', '--default-character-set=utf8mb4',
                    ...(info.transactional ? ['--single-transaction', '--skip-lock-tables'] : ['--lock-all-tables']),
                    ...(client.mysql8 ? ['--column-statistics=0'] : []), ...(!client.mariaDB ? ['--set-gtid-purged=OFF'] : []), '--databases', env.DB_NAME];
                // No shell, command interpolation, or credentials in process arguments/logs.
                const childEnv = { ...process.env }; delete childEnv.MYSQL_PWD;
                child = spawnImpl(env.MYSQLDUMP_PATH || 'mysqldump', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: childEnv });
                child.stderr.resume();
                const closed = once(child, 'close');
                signal?.addEventListener('abort', abort, { once: true });
                if (signal?.aborted) abort();
                let timedOut = false, compressedBytes = 0, rawBytes = 0;
                const deadline = Math.max(1000, Math.min(Number(env.DATABASE_BACKUP_TIMEOUT_MS) || 300000, 1800000));
                timer = setTimeout(() => { timedOut = true; abort(); }, deadline); timer.unref();
                const limiter = new Transform({ transform(chunk, _, callback) {
                    compressedBytes += chunk.length;
                    callback(compressedBytes > maxBytes ? fail(413, 'Backup exceeds the configured download size limit.') : null, chunk);
                } });
                const rawCounter = new Transform({ transform(chunk, _, callback) { rawBytes += chunk.length; callback(null, chunk); } });
                const streaming = pipeline(child.stdout, rawCounter, createGzip({ level: 1 }), limiter, createWriteStream(filePath, { mode: 0o600, flags: 'wx' })).catch(error => { abort(); throw error; });
                // Observe both promises immediately, including when the child fails to start.
                const results = await Promise.allSettled([streaming, closed]);
                clearTimeout(timer); timer = null;
                if (signal?.aborted) throw fail(499, 'Backup cancelled.');
                if (timedOut) throw fail(504, 'Backup preparation timed out. The database may need a longer backup window.');
                if (results[0].status === 'rejected') throw results[0].reason;
                if (results[1].status === 'rejected' || results[1].value[0] !== 0) {
                    // stderr may contain database details; never return it to the browser.
                    throw fail(503, 'Database export failed. Check the dump-client version and database backup privileges on the API server.');
                }
                if (!rawBytes) throw fail(503, 'The database export did not produce a backup.');
                await fs.unlink(configPath);
                const ownedDirectory = directory; directory = null;
                return { filePath, size: compressedBytes, snapshot_mode: info.transactional ? 'transaction' : 'read_lock',
                    filename: `goride-database-${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(/[ :]/g, '-')}-PKT.sql.gz`,
                    cleanup: () => fs.rm(ownedDirectory, { recursive: true, force: true }) };
            } catch (error) {
                abort();
                if (error.status) throw error;
                throw fail(503, 'Unable to prepare a database backup. Check server storage and dump-client configuration.');
            } finally {
                clearTimeout(timer); signal?.removeEventListener('abort', abort);
                if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
                if (lockConn) { await lockConn.query("SELECT RELEASE_LOCK(CONCAT('goride_backup_', LEFT(SHA2(DATABASE(),256),40)))").catch(() => {}); lockConn.release(); }
                busy = false;
            }
        },
    };
}
module.exports = { createDatabaseBackup, connectionOptions, quoteOption };
