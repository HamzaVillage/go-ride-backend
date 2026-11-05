const test = require('node:test');
const assert = require('node:assert/strict');
const { createRedisCache } = require('../services/redisCache');

test('disabled Redis uses authoritative loader and propagates database errors', async () => {
    const cache = createRedisCache();
    assert.equal(await cache.remember('settings', 5, async () => 7), 7);
    await assert.rejects(cache.remember('settings', 5, async () => { throw new Error('DB unavailable'); }), /DB unavailable/);
    assert.equal(await cache.nearby(24, 67, 5, 'mini'), null);
});

test('Redis command failure opens a short circuit so fallback requests do not each wait for Redis', async () => {
    let commands = 0;
    let loads = 0;
    const client = { isReady: true, async sendCommand() { commands++; throw new Error('Redis offline'); } };
    const cache = createRedisCache({ client });
    const load = async () => ++loads;
    assert.equal(await cache.remember('settings', 5, load), 1);
    assert.equal(await cache.remember('settings', 5, load), 2);
    assert.equal(commands, 1);
    assert.equal(cache.ready(), false);
});
