const test = require('node:test');
const assert = require('node:assert/strict');
const { debitDriverForRide } = require('../services/driverWalletLedger');

test('ride deduction adds one completed debit to the driver ledger', async () => {
    const entries = [];
    const conn = { async query(sql, args) {
        if (sql.startsWith('SELECT')) return [entries.filter(e => e.reference === args[1])];
        assert.match(sql, /'debit'/); assert.match(sql, /'completed'/);
        entries.push({ amount: args[1], transaction_type: 'debit', status: 'completed', reference: args[3] });
        return [{ insertId: 1 }];
    } };
    assert.equal((await debitDriverForRide(conn, { driverId: 10, rideId: 1, amount: 500 })).deducted, 500);
    assert.equal((await debitDriverForRide(conn, { driverId: 10, rideId: 1, amount: 500 })).already_applied, true);
    assert.equal(entries.length, 1);
});

test('invalid and conflicting deductions fail instead of silently changing the ledger', async () => {
    const conn = { query: async () => [[{ amount: 100, transaction_type: 'debit', status: 'completed' }]] };
    await assert.rejects(debitDriverForRide(conn, { driverId: 10, rideId: 1, amount: -1 }));
    await assert.rejects(debitDriverForRide(conn, { driverId: 10, rideId: 1, amount: NaN }));
    await assert.rejects(debitDriverForRide(conn, { driverId: 10, rideId: 1, amount: 500 }), /Conflicting/);
});
