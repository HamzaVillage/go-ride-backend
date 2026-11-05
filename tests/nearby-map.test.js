const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { nearbyDriverLocations } = require('../services/driverDispatch');

async function request(query = { lat: 24.86, lng: 67 }, locations = []) {
    let connections = 0;
    const dependencies = {
        '../services/rideCompletionSettlement': require('../services/rideCompletionSettlement'),
        '../services/rideChatService': require('../services/rideChatService'),
        crypto: require('node:crypto'), '../services/rideSearch': {},
        '../services/redisCache': { cache: { remember: async () => ['mini', 'bike'] } },
        '../services/driverDispatch': {
            ...require('../services/driverDispatch'),
            getSearchConfig: async () => ({ maxRadiusKm: 5 }),
            nearbyDriverLocations: async (_io, _db, _lat, _lng, _radius, type) => locations.filter(p => p.vehicle_type === type),
        },
        '../db/Connect_Db': { getConnection() { connections++; throw new Error('Cache hit must not borrow MySQL connection'); } },
        '../socket/socketManager': { getIO: () => ({}) }, '../services/pushNotificationService': {}, '../utils/driverHelper': {},
    };
    const context = { module: { exports: {} }, console, require: id => dependencies[id] };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller/rideController.js'), 'utf8'), context);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await context.module.exports.getNearbyDrivers({ query, user: { userId: 99 } }, res);
    return { res, connections };
}

test('cached nearby map endpoint borrows no database connection and excludes private identity', async () => {
    const result = await request(undefined, [{ sessionId: 'opaque-session', driverId: 10, userId: 10, vehicle_type: 'mini', lat: 24.86012345, lng: 67.00012345, heading: 20, phone: 'private', updatedAt: Date.now() }]);
    assert.equal(result.connections, 0);
    assert.equal(result.res.statusCode, 200);
    const marker = result.res.body.data[0];
    assert.equal(marker.latitude, 24.8601);
    assert.equal(marker.id, 'opaque-session');
    assert.equal(marker.phone, undefined);
    assert.equal(marker.driverId, undefined);
    assert.equal(marker.userId, undefined);
});

test('map endpoint rejects invalid coordinates and can filter the selected category', async () => {
    assert.equal((await request({ lat: null, lng: 67 })).res.statusCode, 400);
    const result = await request({ lat: 24.86, lng: 67, vehicle_type: 'bike' }, [
        { sessionId: 'mini', userId: 10, vehicle_type: 'mini', lat: 24.86, lng: 67 },
        { sessionId: 'bike', userId: 20, vehicle_type: 'bike', lat: 24.86, lng: 67 },
    ]);
    assert.deepEqual(Array.from(result.res.body.data, p => p.id), ['bike']);
});

test('socket fallback excludes distant, stale, busy and duplicate driver sessions', async () => {
    const now = Date.now();
    const presence = overrides => ({ driverId: 10, userId: 10, vehicle_type: 'mini', lat: 24.86, lng: 67, updatedAt: now, ...overrides });
    const sockets = [
        { id: 'old-session', data: { driverPresence: presence({ updatedAt: now - 1000 }) } },
        { id: 'new-session', data: { driverPresence: presence({}) } },
        { id: 'busy', data: { driverPresence: presence({ driverId: 20 }) } },
        { id: 'distant', data: { driverPresence: presence({ driverId: 30, lat: 30 }) } },
        { id: 'stale', data: { driverPresence: presence({ updatedAt: 0 }) } },
    ];
    const io = { in: () => ({ fetchSockets: async () => sockets }) };
    const conn = { query: async () => [[{ id: 10 }]] };
    const results = await nearbyDriverLocations(io, conn, 24.86, 67, 5, 'mini');
    assert.deepEqual(results.map(p => p.sessionId), ['new-session']);
});
