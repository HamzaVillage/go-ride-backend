const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dispatch = require('../services/driverDispatch');

async function request({ offline = false, stale = false, status = 'active', available = 1, busy = false, query = { driver_lat: 30, driver_lng: 70, vehicle_type: 'bike' } } = {}) {
    let listingParams;
    let released = false;
    const conn = { release() { released = true; }, async query(sql, args) {
        if (sql.includes('FROM sysconfigsetup')) return [[{ dispatch_radius_km: 8, dispatch_min_radius_km: 1 }]];
        if (sql.includes('FROM drivers')) return [[{ id: 10, User_ID_FK: 10, vehicle_type: 'Mini', status, Is_Available: available, completed_rides_count: 0 }]];
        if (sql.includes('FROM vehicle_fare_rate')) return [[]];
        if (sql.includes('WHERE Driver_ID_Fk')) return [busy ? [{ Ride_ID_Pk: 3 }] : []];
        if (sql.includes('AS distance_km')) {
            assert.match(sql, /HAVING distance_km <= LEAST/);
            assert.match(sql, /LIMIT 50/);
            assert.match(sql, /r.User_ID_Fk <> \?/);
            assert.match(sql, /LOWER\(TRIM\(r.Vehicle_Type\)\) = \?/);
            listingParams = args;
            return [[]];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    } };
    const dependencies = {
        '../services/rideCompletionSettlement': require('../services/rideCompletionSettlement'),
        '../services/rideChatService': require('../services/rideChatService'),
        '../services/redisCache': require('../services/redisCache'),
        '../services/rideSearch': require('../services/rideSearch'),
        crypto: require('node:crypto'), '../services/driverDispatch': dispatch,
        '../db/Connect_Db': { getConnection: async () => conn },
        '../socket/socketManager': { getIO: () => ({ in: () => ({ fetchSockets: async () => offline ? [] : [{ data: { driverPresence: { driverId: 10, userId: 10, vehicle_type: 'mini', lat: 24.86, lng: 67, updatedAt: stale ? 0 : Date.now() } } }] }) }) },
        '../services/pushNotificationService': {},
        '../utils/driverHelper': { getDriverWalletBalance: async () => 1000, getVehicleMinWalletLimit: async () => 300 },
    };
    const context = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, require(id) {
        if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
        return dependencies[id];
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller/rideController.js'), 'utf8'), context);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await context.module.exports.getNearbyRides({ user: { userId: 10, phone: 'mock' }, query }, res);
    return { res, listingParams, released };
}

test('nearby list ignores client category/location overrides and uses approved category and socket GPS', async () => {
    const result = await request();
    assert.equal(result.res.statusCode, 200);
    assert.deepEqual(Array.from(result.listingParams), [24.86, 67, 24.86, 'mini', 10, 80, 8, 1, 10, 1]);
    assert.equal(result.released, true);
});

for (const options of [{ offline: true }, { stale: true }, { status: 'pending' }, { available: 0 }, { busy: true }]) {
    test(`nearby list is empty for ineligible driver: ${JSON.stringify(options)}`, async () => {
        const result = await request(options);
        assert.equal(result.res.statusCode, 200);
        assert.equal(result.res.body.count, 0);
        assert.equal(result.listingParams, undefined);
        assert.equal(result.released, true);
    });
}

test('invalid GPS request is rejected before database access', async () => {
    const result = await request({ query: { driver_lat: '', driver_lng: 67 } });
    assert.equal(result.res.statusCode, 400);
    assert.equal(result.released, false);
});
