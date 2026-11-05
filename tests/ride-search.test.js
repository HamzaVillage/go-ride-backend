const test = require('node:test');
const assert = require('node:assert/strict');
const { getSearchState, getSearchConfig, dispatchRide } = require('../services/driverDispatch');
const { expireSearch, tickSearches } = require('../services/rideSearch');
const config = { minRadiusKm: 1, maxRadiusKm: 5, stepKm: 1, stageSeconds: 10 };
const ride = (age = 0) => ({ Ride_ID_Pk: 1, User_ID_Fk: 99, Driver_ID_Fk: null, Vehicle_Type: 'Mini', Ride_Status: 'Requested', Pickup_Lat: 24.86, Pickup_Lng: 67, Search_Age_Seconds: age });

test('search expands from database minimum to maximum, with a full final acceptance window', () => {
    for (const [age, radius, exhausted] of [[0, 1, false], [9, 1, false], [10, 2, false], [20, 3, false], [30, 4, false], [40, 5, false], [49, 5, false], [50, 5, true]]) {
        const search = getSearchState(ride(age), config);
        assert.equal(search.radius_km, radius);
        assert.equal(search.exhausted, exhausted);
        assert.equal(search.remaining_seconds, Math.max(0, 50 - age));
    }
});

test('fractional bounds never overshoot and equal minimum/maximum still get one stage', () => {
    const fractional = { ...config, minRadiusKm: 0.75, maxRadiusKm: 2 };
    assert.equal(getSearchState(ride(0), fractional).radius_km, 0.75);
    assert.equal(getSearchState(ride(10), fractional).radius_km, 1.75);
    assert.equal(getSearchState(ride(20), fractional).radius_km, 2);
    assert.equal(getSearchState(ride(30), fractional).exhausted, true);
    const equal = { ...config, minRadiusKm: 2, maxRadiusKm: 2 };
    assert.equal(getSearchState(ride(9), equal).exhausted, false);
    assert.equal(getSearchState(ride(10), equal).exhausted, true);
});

test('invalid min/max configuration fails before dispatch', async () => {
    for (const min of [null, 0, -1, 6, 'bad']) {
        await assert.rejects(getSearchConfig({ query: async () => [[{ dispatch_radius_km: 5, dispatch_min_radius_km: min }]] }));
    }
});

test('a driver outside the current stage is notified only when the radius expands', async () => {
    const notifications = [];
    const socket = { id: 'driver', data: { driverPresence: { driverId: 10, userId: 10, vehicle_type: 'mini', lat: 24.88, lng: 67, updatedAt: Date.now() } } };
    const io = { in: () => ({ fetchSockets: async () => [socket] }), to: ids => ({ emit: () => notifications.push(ids) }) };
    const conn = { query: async () => [[{ id: 10 }]] };
    assert.equal(await dispatchRide(io, conn, ride(0), 'new_ride_request', {}, config), 0);
    assert.equal(await dispatchRide(io, conn, ride(20), 'new_ride_request', {}, config), 1);
    assert.equal(await dispatchRide(io, conn, ride(50), 'new_ride_request', {}, config), 0);
    assert.equal(notifications.length, 1);
});

test('expiry persists no-driver result and removes driver cards exactly once', async () => {
    const events = [];
    let status = 'Requested';
    const conn = { async query(sql, args) {
        if (sql.startsWith('UPDATE')) {
            assert.match(sql, /Ride_Status = 'Requested' AND Driver_ID_Fk IS NULL/);
            assert.match(sql, /TIMESTAMPDIFF/);
            assert.deepEqual(args, [1, 50]);
            const changed = status === 'Requested';
            if (changed) status = 'Cancelled';
            return [{ affectedRows: changed ? 1 : 0 }];
        }
        return [[{ Ride_Status: status, Cancellation_Reason: 'NO_DRIVER_AVAILABLE' }]];
    } };
    const io = { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
    const r = ride(50);
    assert.equal(await expireSearch(conn, io, r, getSearchState(r, config)), true);
    assert.equal(r.Cancellation_Reason, 'NO_DRIVER_AVAILABLE');
    assert.equal(await expireSearch(conn, io, ride(50), getSearchState(r, config)), false);
    assert.deepEqual(events.map(e => e.event), ['ride_search_exhausted', 'ride_unavailable']);
});

test('expiry cannot overwrite a concurrently accepted ride', async () => {
    const r = ride(50);
    const conn = { query: async sql => sql.startsWith('UPDATE') ? [{ affectedRows: 0 }] : [[{ Ride_Status: 'Accepted', Cancellation_Reason: null }]] };
    const io = { to() { throw new Error('Accepted ride must not emit exhaustion'); } };
    assert.equal(await expireSearch(conn, io, r, getSearchState(r, config)), false);
    assert.equal(r.Ride_Status, 'Accepted');
});

test('worker resumes persisted search age after restart and expires even without rider polling', async () => {
    let expired = false;
    const events = [];
    const conn = { async query(sql) {
        if (sql.includes('FROM sysconfigsetup')) return [[{ dispatch_min_radius_km: 1, dispatch_radius_km: 5 }]];
        if (sql.includes('FROM ride_history r LEFT JOIN users')) return [[ride(70)]];
        if (sql.startsWith('UPDATE')) { expired = true; return [{ affectedRows: 1 }]; }
        throw new Error(sql);
    } };
    const io = { to: () => ({ emit: event => events.push(event) }) };
    await tickSearches(conn, io, { cursor: 0, stages: new Map() });
    assert.equal(expired, true);
    assert.ok(events.includes('ride_search_exhausted'));
});

async function statusRequest({ owned = true, age = 0 } = {}) {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    let expired = false;
    let released = false;
    const conn = { release() { released = true; }, async query(sql, args) {
        if (sql.includes('FROM sysconfigsetup')) return [[{ dispatch_min_radius_km: 1, dispatch_radius_km: 5 }]];
        if (sql.startsWith('UPDATE')) { expired = true; return [{ affectedRows: 1 }]; }
        assert.match(sql, /Ride_ID_Pk = \? AND User_ID_Fk = \?/);
        assert.deepEqual(Array.from(args), ['1', 99]);
        return [owned ? [ride(age)] : []];
    } };
    const dependencies = {
        '../services/rideCompletionSettlement': require('../services/rideCompletionSettlement'),
        '../services/rideChatService': require('../services/rideChatService'),
        '../services/redisCache': require('../services/redisCache'),
        crypto: require('node:crypto'), '../services/rideSearch': require('../services/rideSearch'),
        '../services/driverDispatch': require('../services/driverDispatch'),
        '../db/Connect_Db': { getConnection: async () => conn },
        '../socket/socketManager': { getIO: () => ({ to: () => ({ emit() {} }) }) },
        '../services/pushNotificationService': {}, '../utils/driverHelper': {},
    };
    const context = { module: { exports: {} }, console, require(id) {
        if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
        return dependencies[id];
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller/rideController.js'), 'utf8'), context);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await context.module.exports.getSearchStatus({ params: { rideId: '1' }, user: { userId: 99 } }, res);
    return { res, expired, released };
}

test('search status endpoint scopes lookup to the authenticated rider', async () => {
    const result = await statusRequest({ owned: false });
    assert.equal(result.res.statusCode, 404);
    assert.equal(result.expired, false);
    assert.equal(result.released, true);
});

test('search status endpoint reports current stage and remaining time', async () => {
    const result = await statusRequest({ age: 20 });
    assert.equal(result.res.body.search.radius_km, 3);
    assert.equal(result.res.body.search.remaining_seconds, 30);
    assert.equal(result.res.body.status, 'Requested');
    assert.equal(result.expired, false);
});

test('search status endpoint persists and reports no-driver result as a polling fallback', async () => {
    const result = await statusRequest({ age: 50 });
    assert.equal(result.res.body.status, 'Cancelled');
    assert.equal(result.res.body.no_driver_available, true);
    assert.equal(result.expired, true);
    assert.equal(result.released, true);
});
