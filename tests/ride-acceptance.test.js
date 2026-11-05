const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Controller-level concurrency tests with a transactional, row-locking DB double.
// These never connect to a database, SMS service or notification provider.
// Real InnoDB isolation/engine behavior must also be checked before deployment.
function fixture({ failUpdate = false, failCommit = false, wallet = 1000, presenceOverrides = {}, rideAgeSeconds = 0 } = {}) {
    const rides = new Map([1, 2].map(id => [id, {
        Ride_ID_Pk: id, User_ID_Fk: 99, Driver_ID_Fk: null,
        Search_Age_Seconds: rideAgeSeconds, Ride_Status: 'Requested', Vehicle_Type: 'mini', Pickup_Lat: 24.86, Pickup_Lng: 67.0,
    }]));
    const drivers = new Map([10, 20].map(id => [id, {
        id, User_ID_FK: id, status: 'active', vehicle_type: 'mini', Is_Available: 1,
    }]));
    const locks = new Map();
    const events = [];
    const connections = [];
    const pool = { async getConnection() {
        const held = new Map();
        const writes = new Map();
        let active = false;
        async function lock(key) {
            if (held.has(key)) return;
            const previous = locks.get(key) || Promise.resolve();
            let unlock;
            const current = new Promise(resolve => { unlock = resolve; });
            locks.set(key, current);
            await previous;
            held.set(key, () => {
                unlock();
                if (locks.get(key) === current) locks.delete(key);
            });
        }
        function finish() {
            active = false;
            writes.clear();
            held.forEach(unlock => unlock());
            held.clear();
        }
        const conn = {
            released: false, rollbacks: 0, commits: 0,
            async beginTransaction() { assert.equal(active, false); active = true; },
            async commit() {
                assert.equal(active, true);
                if (failCommit) throw new Error('Simulated commit failure');
                writes.forEach((ride, id) => rides.set(id, { ...ride }));
                this.commits++;
                finish();
            },
            async rollback() { this.rollbacks++; finish(); },
            release() { assert.equal(active, false); this.released = true; },
            destroy() { finish(); this.released = true; },
            async query(sql, args = []) {
                if (sql.includes('FROM sysconfigsetup')) return [[{ dispatch_radius_km: 5, dispatch_min_radius_km: 1 }]];
                const id = Number(args[0]);
                if (sql.includes('FROM drivers')) {
                    if (sql.includes('FOR UPDATE')) {
                        assert.equal(active, true);
                        await lock(`driver:${id}`);
                    }
                    return [[...(drivers.has(id) ? [{ ...drivers.get(id) }] : [])]];
                }
                if (sql.includes('WHERE Driver_ID_Fk = ?')) {
                    return [[...rides.values()].filter(r => r.Driver_ID_Fk === id &&
                        ['Accepted', 'Arrived', 'Started', 'Ongoing'].includes(r.Ride_Status))];
                }
                if (sql.startsWith('SELECT')) {
                    const rideId = id;
                    if (sql.includes('FOR UPDATE')) {
                        assert.equal(active, true);
                        await lock(`ride:${rideId}`);
                    }
                    const ride = writes.get(rideId) || rides.get(rideId);
                    if (!ride) return [[]];
                    const row = { ...ride };
                    // MySQL returns the schema's exact column spelling unless aliased.
                    if (/User_ID_FK AS User_ID_Fk/.test(sql) && row.User_ID_FK !== undefined) row.User_ID_Fk = row.User_ID_FK;
                    return [[row]];
                }
                assert.equal(active, true, 'ride mutations must be transactional');
                if (failUpdate) throw new Error('Simulated write failure');
                if (sql.startsWith('DELETE FROM ride_chat_messages')) return [{ affectedRows: 0 }];
                if (sql.includes("Ride_Status = 'Accepted'")) {
                    assert.match(sql, /AND Ride_Status = 'Requested' AND Driver_ID_Fk IS NULL/);
                    assert.match(sql, /TIMESTAMPDIFF\(SECOND, CreatedAt, NOW\(\)\) < \?/);
                    const ride = rides.get(Number(args[1]));
                    if (!ride || ride.Ride_Status !== 'Requested' || ride.Driver_ID_Fk !== null) return [{ affectedRows: 0 }];
                    writes.set(ride.Ride_ID_Pk, { ...ride, Driver_ID_Fk: id, Ride_Status: 'Accepted' });
                } else if (sql.includes("Ride_Status = 'Cancelled'")) {
                    const ride = rides.get(Number(args[2]));
                    writes.set(ride.Ride_ID_Pk, { ...ride, Ride_Status: 'Cancelled', Cancelled_By: args[0] });
                } else {
                    throw new Error(`Unexpected query: ${sql}`);
                }
                return [{ affectedRows: 1 }];
            },
        };
        connections.push(conn);
        return conn;
    }};
    const dependencies = {
        '../services/rideCompletionSettlement': require('../services/rideCompletionSettlement'),
        '../services/rideChatService': require('../services/rideChatService'),
        '../services/redisCache': require('../services/redisCache'),
        '../services/rideSearch': require('../services/rideSearch'),
        crypto: require('node:crypto'),
        '../services/driverDispatch': require('../services/driverDispatch'),
        '../db/Connect_Db': pool,
        '../socket/socketManager': { getIO: () => ({ in: () => ({ fetchSockets: async () => [...drivers.values()].map(d => ({ data: { driverPresence: { driverId: d.id, userId: d.User_ID_FK, vehicle_type: d.vehicle_type, lat: 24.86, lng: 67.0, updatedAt: Date.now(), ...presenceOverrides } } })) }), to: room => ({ emit(event, payload) {
            assert.equal(rides.get(Number(payload.ride_id)).Ride_Status,
                event === 'ride_accepted' ? 'Accepted' : rides.get(Number(payload.ride_id)).Ride_Status);
            events.push({ room, event, payload });
        } }) }) },
        '../services/pushNotificationService': { notifyCustomer: async () => {}, notifyDriver: async () => {} },
        '../utils/driverHelper': { getDriverWalletBalance: async () => wallet, getVehicleMinWalletLimit: async () => 300 },
    };
    const context = { module: { exports: {} }, require(id) {
        if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
        return dependencies[id];
    }, console: { log() {}, warn() {}, error() {} } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller/rideController.js'), 'utf8'), context);
    async function call(action, userId, rideId = 1) {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
        await context.module.exports[action]({ user: { userId, phone: `mock-${userId}` }, body: { ride_id: rideId, reason: 'Changed plans' } }, res);
        return res;
    }
    return { rides, drivers, events, connections, call, assertClean() {
        assert.equal(locks.size, 0);
        assert.ok(connections.every(c => c.released));
    } };
}

test('two drivers accepting concurrently produce one winner', async () => {
    const f = fixture();
    const results = await Promise.all([f.call('acceptRide', 10), f.call('acceptRide', 20)]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    assert.equal(results.find(r => r.statusCode === 409).body.code, 'RIDE_UNAVAILABLE');
    assert.equal(f.events.filter(e => e.event === 'ride_unavailable').length, 1);
    f.assertClean();
});

test('one driver cannot accept two different rides concurrently', async () => {
    const f = fixture();
    const results = await Promise.all([f.call('acceptRide', 10, 1), f.call('acceptRide', 10, 2)]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    assert.equal(results.find(r => r.statusCode === 409).body.code, 'DRIVER_BUSY');
    assert.equal([...f.rides.values()].filter(r => r.Driver_ID_Fk === 10).length, 1);
    f.assertClean();
});

for (const cancelFirst of [true, false]) {
    test(`accept/cancel race stays cancelled (cancel invoked first: ${cancelFirst})`, async () => {
        const f = fixture();
        const actions = cancelFirst ? [['cancelRide', 99], ['acceptRide', 10]] : [['acceptRide', 10], ['cancelRide', 99]];
        const results = await Promise.all(actions.map(([action, id]) => f.call(action, id)));
        assert.equal(results[actions.findIndex(([a]) => a === 'cancelRide')].statusCode, 200);
        assert.equal(f.rides.get(1).Ride_Status, 'Cancelled');
        f.assertClean();
    });
}

test('unrelated account cannot cancel a ride', async () => {
    const f = fixture();
    assert.equal((await f.call('cancelRide', 20)).statusCode, 403);
    assert.equal(f.rides.get(1).Ride_Status, 'Requested');
    assert.equal(f.events.length, 0);
    f.assertClean();
});

test('dual-role rider can cancel own booking but cannot accept it', async () => {
    const f = fixture();
    f.rides.get(1).User_ID_Fk = 10;
    assert.equal((await f.call('acceptRide', 10)).statusCode, 403);
    assert.equal((await f.call('cancelRide', 10)).statusCode, 200);
    f.assertClean();
});

test('assigned driver can cancel their ride', async () => {
    const f = fixture();
    assert.equal((await f.call('acceptRide', 10)).statusCode, 200);
    assert.equal((await f.call('cancelRide', 10)).statusCode, 200);
    assert.equal(f.rides.get(1).Cancelled_By, 'Driver');
    f.assertClean();
});

for (const failure of ['failUpdate', 'failCommit']) {
    test(`${failure} rolls back acceptance and emits no events`, async () => {
        const f = fixture({ [failure]: true });
        assert.equal((await f.call('acceptRide', 10)).statusCode, 500);
        assert.equal(f.rides.get(1).Ride_Status, 'Requested');
        assert.equal(f.events.length, 0);
        assert.equal(f.connections[0].rollbacks, 1);
        f.assertClean();
    });
}

test('insufficient wallet preserves current eligibility behavior and releases locks', async () => {
    const f = fixture({ wallet: 0 });
    const response = await f.call('acceptRide', 10);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.topup_required, true);
    f.assertClean();
});

for (const presenceOverrides of [{ lat: 30 }, { vehicle_type: 'bike' }, { updatedAt: 0 }]) {
    test(`acceptance rejects outside-radius, wrong-category or stale presence: ${JSON.stringify(presenceOverrides)}`, async () => {
        const f = fixture({ presenceOverrides });
        assert.equal((await f.call('acceptRide', 10)).statusCode, 409);
        assert.equal(f.rides.get(1).Ride_Status, 'Requested');
        assert.equal(f.events.length, 0);
        f.assertClean();
    });
}


test('acceptance enforces the expanding radius rather than the final maximum', async () => {
    const early = fixture({ presenceOverrides: { lat: 24.88 } });
    assert.equal((await early.call('acceptRide', 10)).statusCode, 409);
    early.assertClean();
    const expanded = fixture({ presenceOverrides: { lat: 24.88 }, rideAgeSeconds: 20 });
    assert.equal((await expanded.call('acceptRide', 10)).statusCode, 200);
    expanded.assertClean();
});

test('acceptance is rejected after final search window even before expiry worker runs', async () => {
    const f = fixture({ rideAgeSeconds: 50 });
    assert.equal((await f.call('acceptRide', 10)).statusCode, 409);
    assert.equal(f.rides.get(1).Driver_ID_Fk, null);
    assert.equal(f.events.length, 0);
    f.assertClean();
});


test('rider can cancel a searching ride on production uppercase User_ID_FK schema', async () => {
    const f = fixture();
    const ride = f.rides.get(1);
    ride.User_ID_FK = 99;
    delete ride.User_ID_Fk;
    const response = await f.call('cancelRide', 99);
    assert.equal(response.statusCode, 200);
    assert.equal(f.rides.get(1).Ride_Status, 'Cancelled');
    assert.equal(f.rides.get(1).Cancelled_By, 'User');
    assert.ok(f.events.some(e => e.event === 'ride_unavailable'));
    f.assertClean();
});

test('uppercase ownership mapping still rejects unrelated searching-ride cancellation', async () => {
    const f = fixture();
    const ride = f.rides.get(1);
    ride.User_ID_FK = 99;
    delete ride.User_ID_Fk;
    assert.equal((await f.call('cancelRide', 20)).statusCode, 403);
    assert.equal(f.rides.get(1).Ride_Status, 'Requested');
    assert.equal(f.events.length, 0);
    f.assertClean();
});


test('owner cancellation retry succeeds without sending duplicate notifications', async () => {
    const f = fixture();
    assert.equal((await f.call('cancelRide', 99)).statusCode, 200);
    const count = f.events.length;
    const retry = await f.call('cancelRide', 99);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.already_cancelled, true);
    assert.equal(f.events.length, count);
    f.assertClean();
});

test('owner can dismiss an already-expired search but completed rides remain protected', async () => {
    const f = fixture();
    f.rides.get(1).Ride_Status = 'Cancelled';
    f.rides.get(1).Cancellation_Reason = 'NO_DRIVER_AVAILABLE';
    assert.equal((await f.call('cancelRide', 99)).statusCode, 200);
    assert.equal((await f.call('cancelRide', 20)).statusCode, 403);
    f.rides.get(2).Ride_Status = 'Completed';
    assert.equal((await f.call('cancelRide', 99, 2)).statusCode, 400);
    assert.equal(f.rides.get(2).Ride_Status, 'Completed');
    assert.equal(f.events.length, 0);
    f.assertClean();
});
