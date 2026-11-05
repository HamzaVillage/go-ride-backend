const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { deleteRideChat } = require('../services/rideChatService');
const { getDriverWalletBalance } = require('../utils/driverHelper');

// Transactional controller tests; no production balances or external providers.
function fixture({ fare = 500, initialBalance = 1000, payment = 'Cash', riderBalance = 1000, fail = null } = {}) {
    let state = {
        ride: { Ride_ID_Pk: 1, User_ID_Fk: 99, Driver_ID_Fk: 10, Ride_Status: 'Started', Fare: fare, Organization_Fee: 50, Payment_Method: payment, Vehicle_Type: 'Mini' },
        ledger: [{ driver_id: 10, amount: initialBalance, transaction_type: 'credit', status: 'completed', reference_id: 'TOPUP' }],
        riderBalance, riderTransactions: [], earnings: [], driver: { id: 10, completed_rides_count: 0, driver_earnings_sum: 0 }, messages: ['private message'],
    };
    let tail = Promise.resolve();
    const events = [];
    let pushes = 0;
    let openConnections = 0;
    const pool = { async getConnection() {
        openConnections++;
        let active = false;
        let local;
        let unlock;
        return {
            async beginTransaction() { active = true; },
            async commit() { state = local; active = false; unlock?.(); unlock = null; },
            async rollback() { active = false; unlock?.(); unlock = null; },
            release() { assert.equal(active, false); openConnections--; }, destroy() { unlock?.(); active = false; openConnections--; },
            async query(sql, args = []) {
                assert.equal(active, true, 'all settlement reads/writes must be inside the transaction');
                if (sql.includes('FROM ride_history') && sql.includes('FOR UPDATE')) {
                    const previous = tail;
                    tail = new Promise(resolve => { unlock = resolve; });
                    await previous;
                    local = structuredClone(state);
                    return [[{ ...local.ride }]];
                }
                if (sql.includes('FROM ride_history')) return [[{ ...local.ride }]];
                if (sql.includes('FROM drivers') && sql.includes('WHERE id = ? AND')) {
                    assert.match(sql, /FOR UPDATE/);
                    return [args[1] === 10 ? [{ ...local.driver }] : []];
                }
                if (sql.includes('FROM driver_wallet') && sql.includes('reference_id = ?')) {
                    return [local.ledger.filter(row => row.driver_id === args[0] && row.reference_id === args[1])];
                }
                if (sql.includes('FROM driver_wallet')) {
                    if (fail === 'balance') throw new Error('Balance read failed');
                    const balance = local.ledger.filter(row => row.status === 'completed').reduce((n, row) => n + (row.transaction_type === 'credit' ? row.amount : -row.amount), 0);
                    return [[{ balance }]];
                }
                if (sql.includes('FROM user_wallets')) return [[{ balance: local.riderBalance }]];
                if (sql.startsWith('UPDATE user_wallets')) { local.riderBalance -= args[0]; return [{ affectedRows: 1 }]; }
                if (sql.startsWith('INSERT INTO user_wallet_transactions')) { local.riderTransactions.push(args); return [{ insertId: 1 }]; }
                if (sql.startsWith('INSERT INTO driver_wallet')) {
                    const type = sql.includes("'debit'") ? 'debit' : 'credit';
                    if (fail === 'debit' && type === 'debit') throw new Error('Ledger write failed');
                    local.ledger.push({ driver_id: args[0], amount: args[1], transaction_type: type, reference_id: args[3], status: 'completed' });
                    return [{ insertId: local.ledger.length }];
                }
                if (sql.startsWith('INSERT INTO driver_earnings')) {
                    if (fail === 'earnings') throw new Error('Earnings write failed');
                    local.earnings.push(args); return [{ insertId: 1 }];
                }
                if (sql.startsWith('UPDATE drivers')) { local.driver.completed_rides_count++; local.driver.driver_earnings_sum += args[0]; return [{ affectedRows: 1 }]; }
                if (sql.includes('FROM drivers')) return [[{ ...local.driver }]];
                if (sql.includes('FROM vehicle_fare_rate')) {
                    if (fail === 'minimum' && sql.includes('LOWER')) throw new Error('Minimum configuration read failed');
                    return [[{ rides_limit: 0, rides_over_limit_count: 300 }]];
                }
                if (sql.startsWith('UPDATE ride_history')) {
                    if (sql.includes('Ride_Status')) local.ride.Ride_Status = 'Completed';
                    else { local.ride.Payment_Method = args[0]; if (sql.includes('Payment_Status')) local.ride.Payment_Status = args[1]; }
                    return [{ affectedRows: 1 }];
                }
                if (sql.startsWith('DELETE FROM ride_chat_messages')) {
                    if (fail === 'chat') throw new Error('Chat deletion failed');
                    local.messages = []; return [{ affectedRows: 1 }];
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            },
        };
    } };
    const dependencies = {
        '../services/rideCompletionSettlement': require('../services/rideCompletionSettlement'),
        '../services/rideChatService': { deleteRideChat, closeChatRoom() { assert.equal(state.messages.length, 0); } },
        crypto: require('node:crypto'), '../services/redisCache': {}, '../services/rideSearch': {}, '../services/driverDispatch': {},
        '../db/Connect_Db': pool, '../socket/socketManager': { getIO: () => ({ to: room => ({ emit: (event, data) => events.push({ room, event, data }) }) }) },
        '../services/pushNotificationService': { notifyCustomer: async () => { pushes++; } }, '../utils/driverHelper': {},
    };
    const context = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, require: id => dependencies[id] };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller/rideController.js'), 'utf8'), context);
    return { state: () => state, events, pushes: () => pushes, clean: () => assert.equal(openConnections, 0), async complete(userId = 10) {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
        await context.module.exports.completeRide({ user: { userId, phone: '' }, body: { ride_id: 1 } }, res);
        return res;
    } };
}

test('cash ride deducts full Rs.500, not Rs.50 commission, and refreshes wallet balance', async () => {
    const f = fixture();
    const result = await f.complete();
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.driver_wallet_deduction, 500);
    assert.equal(result.body.wallet_balance, 500);
    assert.equal(result.body.topup_required, false);
    assert.equal(f.state().ledger.filter(row => row.transaction_type === 'debit').length, 1);
    assert.equal(f.state().earnings[0][4], 450, 'earnings calculation remains fare minus commission');
    assert.equal(f.events.find(e => e.event === 'driver:wallet_updated').data.wallet_balance, 500);
    f.clean();
});

for (const fare of [1000, 800, 1200]) {
    test(`completion can exhaust wallet or cross the minimum; fare=${fare}`, async () => {
        const f = fixture({ fare });
        const result = await f.complete();
        assert.equal(result.statusCode, 200);
        assert.equal(result.body.wallet_balance, 1000 - fare);
        assert.equal(result.body.topup_required, true);
        assert.equal(result.body.is_wallet_sufficient, false);
        assert.equal(f.state().ride.Ride_Status, 'Completed');
        f.clean();
    });
}

test('simultaneous/retried completion deducts once and creates one earning/push', async () => {
    const f = fixture();
    const results = await Promise.all([f.complete(), f.complete()]);
    assert.ok(results.every(r => r.statusCode === 200));
    assert.deepEqual(results.map(r => r.body.already_completed), [false, true]);
    assert.equal(f.state().ledger.filter(row => row.transaction_type === 'debit').length, 1);
    assert.equal(f.state().earnings.length, 1);
    assert.equal(f.state().driver.completed_rides_count, 1);
    assert.equal(f.pushes(), 1);
    assert.equal((await f.complete()).body.wallet_balance, 500);
    f.clean();
});

for (const failure of ['debit', 'earnings', 'balance', 'minimum', 'chat']) {
    test(`${failure} failure rolls back wallet, status, earnings and chat together`, async () => {
        const f = fixture({ fail: failure });
        assert.equal((await f.complete()).statusCode, 500);
        assert.equal(f.state().ride.Ride_Status, 'Started');
        assert.equal(f.state().ledger.length, 1);
        assert.equal(f.state().earnings.length, 0);
        assert.equal(f.state().messages.length, 1);
        assert.equal(f.events.length, 0);
        assert.equal(f.pushes(), 0);
        f.clean();
    });
}

test('unrelated user cannot charge driver wallet', async () => {
    const f = fixture();
    assert.equal((await f.complete(20)).statusCode, 403);
    assert.equal(f.state().ledger.length, 1);
    f.clean();
});

test('wallet-paid ride preserves digital earnings credit and adds the full fare debit', async () => {
    const f = fixture({ payment: 'Wallet' });
    const result = await f.complete();
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.driver_wallet_deduction, 500);
    assert.equal(f.state().riderBalance, 500);
    assert.equal(f.state().riderTransactions.length, 1);
    assert.equal(result.body.wallet_balance, 950, '1000 + 450 digital earning credit - 500 fare charge');
    assert.equal(f.state().ledger.filter(row => row.reference_id === 'RIDE_CREDIT_1').length, 1);
    await f.complete();
    assert.equal(f.state().riderBalance, 500);
    f.clean();
});

test('insufficient rider wallet keeps existing cash fallback and full driver deduction', async () => {
    const f = fixture({ payment: 'Wallet', riderBalance: 100 });
    const result = await f.complete();
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.ride.Payment_Method, 'Cash');
    assert.equal(result.body.wallet_balance, 500);
    assert.equal(f.state().riderBalance, 100);
    f.clean();
});

test('zero driver ledger cannot revive customer wallet funds', async () => {
    let queries = 0;
    const conn = { async query(sql) {
        queries++;
        assert.match(sql, /FROM driver_wallet/);
        return [[{ balance: 0 }]];
    } };
    assert.equal(await getDriverWalletBalance(conn, 10, 99), 0);
    assert.equal(queries, 1, 'must not query user_wallets as a fallback');
});


test('balance exactly at the configured minimum stays eligible', async () => {
    const f = fixture({ fare: 700 });
    const result = await f.complete();
    assert.equal(result.body.wallet_balance, 300);
    assert.equal(result.body.topup_required, false);
    assert.equal(result.body.is_wallet_sufficient, true);
    f.clean();
});

test('wallet paid status is preserved when the existing schema provides that column', async () => {
    const f = fixture({ payment: 'Wallet' });
    f.state().ride.Payment_Status = 'Unpaid';
    const result = await f.complete();
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.ride.Payment_Status, 'Paid');
    f.clean();
});
