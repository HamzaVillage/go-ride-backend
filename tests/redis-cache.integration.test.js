const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createClient } = require('redis');
const { createRedisCache } = require('../services/redisCache');

test('real Redis: cache hits, concurrent misses, TTL, GEO presence, offline cleanup and outage fallback', {
    skip: process.env.RUN_REDIS_INTEGRATION !== '1', timeout: 15000,
}, async t => {
    const directory = fs.mkdtempSync('/private/tmp/goride-redis-');
    const socketPath = path.join(directory, 'redis.sock');
    const server = spawn(process.env.REDIS_SERVER || 'redis-server', ['--port', '0', '--unixsocket', socketPath, '--save', '', '--appendonly', 'no'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    server.stdout.on('data', data => { log += data; });
    server.stderr.on('data', data => { log += data; });
    let startError;
    server.on('error', error => { startError = error; });
    const client = createClient({ socket: { path: socketPath, reconnectStrategy: false, connectTimeout: 1000 }, disableOfflineQueue: true });
    client.on('error', () => {});
    t.after(async () => {
        if (client.isOpen) client.destroy();
        if (server.exitCode === null && !server.killed) {
            const exited = new Promise(resolve => server.once('exit', resolve));
            server.kill('SIGTERM');
            await exited;
        }
        fs.rmSync(directory, { recursive: true, force: true });
    });
    for (let i = 0; i < 60 && !fs.existsSync(socketPath); i++) {
        if (startError) throw startError;
        if (server.exitCode !== null) throw new Error(`Redis server exited: ${server.exitCode}: ${log}`);
        await delay(25);
    }
    await client.connect();
    const cache = createRedisCache({ client, prefix: 'test:' });
    let loads = 0;
    const load = async () => { loads++; return { min: 1, max: 5 }; };
    const results = await Promise.all(Array.from({ length: 10 }, () => cache.remember('settings', 1, load)));
    assert.equal(loads, 1);
    assert.equal(results[0].max, 5);
    await cache.remember('settings', 1, load);
    assert.equal(loads, 1, 'second read must use Redis instead of the DB loader');

    const presence = { driverId: 10, userId: 10, vehicle_type: 'mini', lat: 24.86, lng: 67, heading: 20, updatedAt: Date.now() };
    await cache.putPresence('near', presence, 1);
    await cache.putPresence('far', { ...presence, lat: 30 }, 1);
    const nearby = await cache.nearby(24.86, 67, 5, 'mini');
    assert.deepEqual(nearby.map(p => p.sessionId), ['near']);
    assert.deepEqual(await cache.nearby(24.86, 67, 5, 'bike'), []);
    await cache.removePresence('near', 'mini');
    assert.deepEqual(await cache.nearby(24.86, 67, 5, 'mini'), []);
    await cache.putPresence('expiring', presence, 1);
    await delay(1100);
    assert.deepEqual(await cache.nearby(24.86, 67, 5, 'mini'), []);
    await cache.remember('settings', 1, load);
    assert.equal(loads, 2, 'expired settings must reload');
    await client.sendCommand(['CLIENT', 'PAUSE', '800', 'ALL']);
    const start = Date.now();
    await cache.remember('paused-cache', 1, load);
    assert.equal(cache.ready(), false, 'a timed-out command should open the circuit');
    assert.ok(Date.now() - start < 1000, 'a paused Redis must have a bounded fallback delay');
    assert.equal(loads, 3);
    client.destroy();
    assert.equal(await cache.nearby(24.86, 67, 5, 'mini'), null, 'null means use socket fallback');
    await cache.remember('settings', 1, load);
    assert.equal(loads, 4, 'disconnected Redis must use DB loader');
});
