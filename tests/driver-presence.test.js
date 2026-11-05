const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function fixture({ status = 'active', available = 1, busy = false, walletWait, recoveryWait } = {}) {
    let connectionHandler;
    const events = new Map();
    const emitted = [];
    const rooms = new Set();
    const driver = { id: 10, User_ID_FK: 10, status, Is_Available: available, vehicle_type: 'Mini', completed_rides_count: 0 };
    const conn = { release() {}, async query(sql) {
        if (sql.includes('FROM drivers')) return [[driver]];
        if (sql.includes('FROM vehicle_fare_rate')) return [[]];
        if (sql.includes('WHERE Driver_ID_Fk')) return [busy ? [{ Ride_ID_Pk: 1 }] : []];
        if (sql.includes('FROM ride_history')) return [[]];
        throw new Error(`Unexpected query ${sql}`);
    } };
    class Server {
        use() {}
        on(event, cb) { if (event === 'connection') connectionHandler = cb; }
    }
    let connections = 0;
    const dependencies = {
        '../services/rideCompletionSettlement': require('../services/rideCompletionSettlement'),
        '../services/rideChatService': require('../services/rideChatService'),
        '../services/redisCache': require('../services/redisCache'),
        'socket.io': { Server }, jsonwebtoken: {},
        '../db/Connect_Db': { getConnection: async () => {
            if (++connections === 1 && recoveryWait) await recoveryWait;
            return conn;
        } },
        '../services/driverDispatch': require('../services/driverDispatch'),
        '../utils/driverHelper': { getDriverWalletBalance: async () => { if (walletWait) await walletWait; return 1000; }, getVehicleMinWalletLimit: async () => 300 },
    };
    const context = { module: { exports: {} }, require: id => {
        if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
        return dependencies[id];
    }, console: { log() {}, warn() {}, error() {} } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../socket/socketManager.js'), 'utf8'), context);
    context.module.exports.initSocket({});
    const socket = {
        id: 'mock-driver', connected: true, user: { userId: 10, phone: 'mock' }, data: {},
        async join(room) { rooms.add(room); }, async leave(room) { rooms.delete(room); },
        on(event, cb) { events.set(event, cb); }, emit(event, payload) { emitted.push({ event, payload }); },
    };
    const connecting = connectionHandler(socket);
    if (!recoveryWait) await connecting;
    return { socket, emitted, rooms, hasEvent: name => events.has(name), event: (name, payload) => events.get(name)(payload) };
}

test('immediate online event registers even while ride recovery is waiting for the database', async () => {
    let release;
    const recoveryWait = new Promise(resolve => { release = resolve; });
    const f = await fixture({ recoveryWait });
    try {
        assert.equal(f.hasEvent('driver:online'), true);
        await f.event('driver:online', { lat: 24.86, lng: 67 });
        assert.equal(f.socket.data.driverPresence.driverId, 10);
        assert.equal(f.rooms.has('vehicle:mini'), true);
        assert.equal(f.emitted.at(-1).payload.success, true);
    } finally { release(); }
});

test('going online uses approved category rather than client category', async () => {
    const f = await fixture();
    await f.event('driver:online', { lat: 0, lng: 0, vehicle_type: 'bike' });
    assert.equal(f.socket.data.driverPresence.vehicle_type, 'mini');
    assert.equal(f.socket.data.driverPresence.driverId, 10);
    assert.equal(f.rooms.has('vehicle:mini'), true);
    assert.equal(f.rooms.has('vehicle:bike'), false);
    assert.equal(f.emitted.at(-1).payload.success, true);
});

for (const options of [{ status: 'pending' }, { available: 0 }, { busy: true }]) {
    test(`unapproved/unavailable/busy driver cannot register: ${JSON.stringify(options)}`, async () => {
        const f = await fixture(options);
        await f.event('driver:online', { lat: 24.86, lng: 67 });
        assert.equal(f.socket.data.driverPresence, null);
        assert.equal(f.rooms.has('vehicle:mini'), false);
        assert.equal(f.emitted.at(-1).payload.success, false);
    });
}

test('invalid GPS cannot create presence', async () => {
    const f = await fixture();
    await f.event('driver:online', { lat: null, lng: 67 });
    assert.equal(f.socket.data.driverPresence, null);
    assert.equal(f.emitted.at(-1).payload.success, false);
});

test('presence heartbeat cannot invent identity, change category, or reactivate offline driver', async () => {
    const f = await fixture();
    f.event('driver:presence', { lat: 24, lng: 67 });
    assert.equal(f.socket.data.driverPresence, undefined);
    await f.event('driver:online', { lat: 24.86, lng: 67 });
    f.event('driver:presence', { lat: 25, lng: 68, driverId: 999, vehicle_type: 'bike' });
    assert.equal(f.socket.data.driverPresence.driverId, 10);
    assert.equal(f.socket.data.driverPresence.vehicle_type, 'mini');
    assert.equal(f.socket.data.driverPresence.lat, 25);
    f.event('driver:offline');
    f.event('driver:presence', { lat: 25, lng: 68 });
    assert.equal(f.socket.data.driverPresence, null);
    assert.equal(f.rooms.has('vehicle:mini'), false);
});

test('offline during an in-flight online request cannot bring driver online again', async () => {
    let release;
    const walletWait = new Promise(resolve => { release = resolve; });
    const f = await fixture({ walletWait });
    const online = f.event('driver:online', { lat: 24.86, lng: 67 });
    await new Promise(resolve => setImmediate(resolve));
    f.event('driver:offline');
    release();
    await online;
    assert.equal(f.socket.data.driverPresence, null);
    assert.equal(f.rooms.has('vehicle:mini'), false);
    assert.equal(f.emitted.length, 0);
});
