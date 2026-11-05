const { createClient } = require('redis');

function createRedisCache({ client = null, prefix = 'goride:', timeoutMs = 300 } = {}) {
    const pending = new Map();
    let retryAfter = 0;
    const key = value => `${prefix}${value}`;
    const ready = () => !!client?.isReady && Date.now() >= retryAfter;
    async function command(args) {
        if (!ready()) return null;
        let timer;
        try {
            // The library's queue timeout ends when bytes are written. Bound the
            // full response wait as well (e.g. Redis is paused or unresponsive).
            const deadline = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Redis response timeout')), timeoutMs);
                timer.unref?.();
            });
            return await Promise.race([client.sendCommand(args.map(String), { timeout: timeoutMs }), deadline]);
        } catch {
            retryAfter = Date.now() + 2000;
            return null; // A cache outage must not block the authoritative DB path.
        } finally {
            clearTimeout(timer);
        }
    }
    async function remember(name, ttlSeconds, load) {
        if (!ready()) return load();
        if (pending.has(name)) return pending.get(name);
        const promise = (async () => {
            const cached = await command(['GET', key(name)]);
            if (cached !== null) {
                try { return JSON.parse(cached); } catch { /* Reload malformed entries. */ }
            }
            const value = await load();
            await command(['SET', key(name), JSON.stringify(value), 'EX', ttlSeconds]);
            return value;
        })();
        pending.set(name, promise);
        try { return await promise; } finally { pending.delete(name); }
    }
    async function putPresence(sessionId, presence, ttlSeconds) {
        if (!ready() || Math.abs(presence.lat) > 85.05112878) return;
        // One atomic command preserves update/offline ordering on the connection.
        const script = `local stale = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ARGV[6], 'LIMIT', 0, 100)
            for _, id in ipairs(stale) do redis.call('ZREM', KEYS[2], id); redis.call('ZREM', KEYS[3], id) end
            redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
            redis.call('GEOADD', KEYS[2], ARGV[3], ARGV[4], ARGV[5])
            redis.call('ZADD', KEYS[3], ARGV[7], ARGV[5])
            redis.call('EXPIRE', KEYS[2], ARGV[2] * 2)
            redis.call('EXPIRE', KEYS[3], ARGV[2] * 2)
            return 1`;
        await command(['EVAL', script, 3, key(`presence:${sessionId}`), key(`geo:${presence.vehicle_type}`), key(`geo-age:${presence.vehicle_type}`),
            JSON.stringify({ ...presence, sessionId }), ttlSeconds, presence.lng, presence.lat, sessionId, presence.updatedAt - ttlSeconds * 1000, presence.updatedAt]);
    }
    async function removePresence(sessionId, vehicleType) {
        if (!vehicleType) return;
        await command(['EVAL', "redis.call('DEL', KEYS[1]); redis.call('ZREM', KEYS[2], ARGV[1]); redis.call('ZREM', KEYS[3], ARGV[1]); return 1", 3,
            key(`presence:${sessionId}`), key(`geo:${vehicleType}`), key(`geo-age:${vehicleType}`), sessionId]);
    }
    async function nearby(lat, lng, radiusKm, vehicleType) {
        if (!ready()) return null;
        const ids = await command(['GEOSEARCH', key(`geo:${vehicleType}`), 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusKm, 'km', 'ASC', 'COUNT', 100]);
        if (ids === null) return null;
        if (!ids.length) return [];
        const values = await command(['MGET', ...ids.map(id => key(`presence:${id}`))]);
        if (values === null) return null;
        return values.flatMap(value => {
            try { return value ? [JSON.parse(value)] : []; } catch { return []; }
        });
    }
    return { ready, remember, putPresence, removePresence, nearby };
}

let client = null;
if (process.env.REDIS_URL) {
    client = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true, commandsQueueMaxLength: 1000,
        socket: { connectTimeout: 1000, reconnectStrategy: retries => Math.min(5000, 250 * (retries + 1)) } });
    let reported = false;
    client.on('error', () => {
        if (!reported) console.warn('Redis unavailable; using database/socket fallback.');
        reported = true;
    });
    client.on('ready', () => { reported = false; console.log('Redis cache connected'); });
}
const cache = createRedisCache({ client, prefix: process.env.REDIS_KEY_PREFIX || 'goride:' });
function connectRedis() {
    if (client && !client.isOpen) client.connect().catch(() => {});
}
function closeRedis() { if (client?.isOpen) client.destroy(); }
module.exports = { cache, connectRedis, closeRedis, createRedisCache };
