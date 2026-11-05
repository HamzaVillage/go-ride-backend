const test = require('node:test');
const assert = require('node:assert/strict');
const { validCoordinates, freshPresence, matchesRide, distanceKm, presenceTtlMs, getDispatchRadiusKm, dispatchRide, getDriverPresence } = require('../services/driverDispatch');

const ride = () => ({ Ride_ID_Pk: 1, User_ID_Fk: 99, Driver_ID_Fk: null, Search_Age_Seconds: 0, Ride_Status: 'Requested', Vehicle_Type: 'Mini', Pickup_Lat: 24.86, Pickup_Lng: 67.0 });
const presence = (overrides = {}) => ({ driverId: 10, userId: 10, vehicle_type: 'mini', lat: 24.86, lng: 67.0, updatedAt: Date.now(), ...overrides });

test('GPS validation accepts zero/string numbers and rejects missing/out-of-range/non-finite values', () => {
    assert.equal(validCoordinates(0, '0'), true);
    for (const value of [null, undefined, '', ' ', NaN, Infinity, {}, true, []]) assert.equal(validCoordinates(value, 0), false);
    assert.equal(validCoordinates(91, 0), false);
    assert.equal(validCoordinates(0, -181), false);
});

test('freshness requires recent server timestamp, never a future or missing timestamp', () => {
    const now = Date.now();
    assert.equal(freshPresence(presence({ updatedAt: now - presenceTtlMs }), now), true);
    for (const updatedAt of [now - presenceTtlMs - 1, now + 1, undefined]) assert.equal(freshPresence(presence({ updatedAt }), now), false);
});

test('matching requires category, radius, fresh GPS and a different rider identity', () => {
    assert.equal(matchesRide(presence(), ride(), 5), true);
    assert.equal(distanceKm(24.86, 67, 24.86, 67), 0);
    for (const override of [
        { vehicle_type: 'bike' }, { userId: 99 }, { lat: 30 },
        { updatedAt: Date.now() - presenceTtlMs - 100 }, { lng: null },
    ]) assert.equal(matchesRide(presence(override), ride(), 5), false);
    assert.equal(matchesRide(presence(), { ...ride(), Pickup_Lng: null }, 5), false);

});

test('dispatch targets only nearby eligible sockets, never the whole vehicle room', async () => {
    const sockets = [
        { id: 'near', data: { driverPresence: presence() } },
        { id: 'busy-or-blocked', data: { driverPresence: presence({ driverId: 20, userId: 20 }) } },
        { id: 'far', data: { driverPresence: presence({ driverId: 30, lat: 30 }) } },
        { id: 'stale', data: { driverPresence: presence({ updatedAt: 0 }) } },
        { id: 'offline', data: {} },
        { id: 'wrong-category', data: { driverPresence: presence({ vehicle_type: 'bike' }) } },
    ];
    const emitted = [];
    const io = {
        in(room) { assert.equal(room, 'vehicle:mini'); return { fetchSockets: async () => sockets }; },
        to(ids) { emitted.push(ids); return { emit(event) { assert.equal(event, 'new_ride_request'); } }; },
    };
    const conn = { async query(sql, params) {
        if (sql.includes('FROM sysconfigsetup')) return [[{ dispatch_radius_km: 5, dispatch_min_radius_km: 1 }]];
        assert.match(sql, /LOWER\(TRIM\(d.status\)\) = 'active'/);
        assert.match(sql, /d.Is_Available = 1/);
        assert.match(sql, /NOT EXISTS/);
        assert.match(sql, /overdue_since/);
        assert.deepEqual(params, [10, 20, 'mini']);
        return [[{ id: 10 }]];
    } };
    assert.equal(await dispatchRide(io, conn, ride(), 'new_ride_request', {}), 1);
    assert.deepEqual(emitted, [['near']]);
});

test('fare update uses the same dispatch filtering and assigned rides are not dispatched', async () => {
    let calls = 0;
    const io = { in: () => ({ fetchSockets: async () => [{ id: 'near', data: { driverPresence: presence() } }] }), to: () => ({ emit(event) { assert.equal(event, 'fare_updated'); calls++; } }) };
    const conn = { query: async sql => sql.includes('FROM sysconfigsetup') ? [[{ dispatch_radius_km: 5, dispatch_min_radius_km: 1 }]] : [[{ id: 10 }]] };
    await dispatchRide(io, conn, ride(), 'fare_updated', {});
    assert.equal(await dispatchRide(io, conn, { ...ride(), Ride_Status: 'Accepted', Driver_ID_Fk: 10 }, 'fare_updated', {}), 0);
    assert.equal(calls, 1);
});

test('offline drivers do not trigger candidate queries or receive a notification', async () => {
    const io = { in: () => ({ fetchSockets: async () => [] }) };
    const conn = { async query(sql) { assert.match(sql, /FROM sysconfigsetup/); return [[{ dispatch_radius_km: 5, dispatch_min_radius_km: 1 }]]; } };
    assert.equal(await dispatchRide(io, conn, ride(), 'new_ride_request', {}), 0);
});

test('presence lookup selects the newest valid session for the authenticated identity', async () => {
    const now = Date.now();
    const io = { in(room) {
        assert.equal(room, 'user:10');
        return { fetchSockets: async () => [
            { data: { driverPresence: presence({ updatedAt: now - 1000 }) } },
            { data: { driverPresence: presence({ updatedAt: now, lat: 25 }) } },
            { data: { driverPresence: presence({ userId: 11 }) } },
        ] };
    } };
    assert.equal((await getDriverPresence(io, 10, 10)).lat, 25);
    assert.equal(await getDriverPresence(io, 20, 10), null);
});


test('database radius is reloaded without restart and changes matching distance', async () => {
    let value = '2.00';
    const conn = { query: async () => [[{ dispatch_radius_km: value, dispatch_min_radius_km: 1 }]] };
    const target = { ...ride(), Pickup_Lat: 24.90 };
    assert.equal(matchesRide(presence(), target, await getDispatchRadiusKm(conn)), false);
    value = '8.00';
    assert.equal(matchesRide(presence(), target, await getDispatchRadiusKm(conn)), true);
});

test('invalid/missing database radius fails rather than silently using another distance', async () => {
    for (const value of [null, undefined, 0, -1, 'bad']) {
        await assert.rejects(getDispatchRadiusKm({ query: async () => [[{ dispatch_radius_km: value, dispatch_min_radius_km: 1 }]] }), /Configure positive/);
    }
    await assert.rejects(getDispatchRadiusKm({ query: async () => [[]] }), /Configure positive/);
});
