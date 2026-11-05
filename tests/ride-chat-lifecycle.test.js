const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { deleteRideChat } = require('../services/rideChatService');

function fixture({ status = 'Started', failDeletion = false } = {}) {
    let state = { ride: { Ride_ID_Pk: 1, User_ID_Fk: 99, Driver_ID_Fk: 10, Ride_Status: status, Fare: 0, Organization_Fee: 0, Payment_Method: 'Cash', Vehicle_Type: 'mini' }, messages: ['private message'] };
    let local;
    let active = false;
    let closed = 0;
    const conn = {
        async beginTransaction() { active = true; local = structuredClone(state); },
        async commit() { state = local; active = false; },
        async rollback() { active = false; }, release() { assert.equal(active, false); }, destroy() { active = false; },
        async query(sql, args = []) {
            if (sql.includes('FROM ride_history')) return [[{ ...(active ? local : state).ride }]];
            if (sql.startsWith('UPDATE ride_history')) {
                assert.equal(active, true);
                local.ride.Ride_Status = sql.includes("'Completed'") ? 'Completed' : 'Cancelled';
                return [{ affectedRows: 1 }];
            }
            if (sql.startsWith('DELETE FROM ride_chat_messages')) {
                assert.equal(active, true, 'delete must be inside the ride transition transaction');
                if (failDeletion) throw new Error('Cannot delete chat');
                local.messages = [];
                return [{ affectedRows: 1 }];
            }
            if (sql.includes('FROM drivers') && sql.includes('WHERE id = ? AND')) return [Number(args[1]) === 10 ? [{ id: 10 }] : []];
            if (sql.includes('SELECT phone FROM drivers')) return [[{ phone: 'driver-phone' }]];
            if (sql.includes('SELECT User_ID_Pk')) return [[{ User_ID_Pk: 10 }]];
            if (sql.startsWith('SELECT')) return [[{ completed_rides_count: 0 }]];
            return [{ affectedRows: 1 }];
        },
    };
    const dependencies = {
        '../services/rideCompletionSettlement': require('../services/rideCompletionSettlement'),
        '../services/rideChatService': { deleteRideChat, closeChatRoom() { assert.equal(active, false); assert.equal(state.messages.length, 0); closed++; } },
        crypto: require('node:crypto'), '../services/redisCache': {}, '../services/rideSearch': {}, '../services/driverDispatch': {},
        '../db/Connect_Db': { getConnection: async () => conn },
        '../socket/socketManager': { getIO: () => ({ to: () => ({ emit() {} }) }) },
        '../services/pushNotificationService': { notifyCustomer: async () => {}, notifyDriver: async () => {} }, '../utils/driverHelper': {},
    };
    const context = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, require: id => dependencies[id] };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller/rideController.js'), 'utf8'), context);
    return { state: () => state, closed: () => closed, async call(action, userId) {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
        await context.module.exports[action]({ user: { userId, phone: userId === 10 ? 'driver-phone' : 'customer-phone' }, body: { ride_id: 1, reason: 'Changed plans' } }, res);
        return res;
    } };
}

test('complete endpoint deletes chat atomically and closes the realtime room after commit', async () => {
    const f = fixture();
    assert.equal((await f.call('completeRide', 10)).statusCode, 200);
    assert.equal(f.state().ride.Ride_Status, 'Completed');
    assert.equal(f.state().messages.length, 0);
    assert.equal(f.closed(), 1);
});

test('cancel endpoint deletes chat atomically and closes the realtime room after commit', async () => {
    const f = fixture({ status: 'Accepted' });
    assert.equal((await f.call('cancelRide', 99)).statusCode, 200);
    assert.equal(f.state().ride.Ride_Status, 'Cancelled');
    assert.equal(f.state().messages.length, 0);
    assert.equal(f.closed(), 1);
});

test('unrelated account cannot complete a ride or erase its chat', async () => {
    const f = fixture();
    assert.equal((await f.call('completeRide', 20)).statusCode, 403);
    assert.equal(f.state().ride.Ride_Status, 'Started');
    assert.equal(f.state().messages.length, 1);
    assert.equal(f.closed(), 0);
});

test('chat deletion failure rolls back both completion and cancellation', async () => {
    for (const [action, userId, status] of [['completeRide', 10, 'Started'], ['cancelRide', 99, 'Accepted']]) {
        const f = fixture({ status, failDeletion: true });
        assert.equal((await f.call(action, userId)).statusCode, 500);
        assert.equal(f.state().ride.Ride_Status, status);
        assert.equal(f.state().messages.length, 1);
        assert.equal(f.closed(), 0);
    }
});
