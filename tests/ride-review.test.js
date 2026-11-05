const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
async function review({ userId = 20, driverUserId = 30, status = 'Completed', body = {}, failAverage = false } = {}) {
    const writes = []; let committed = false; let rolledBack = false; let released = false;
    const conn = { beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => { rolledBack = true; }, release: () => { released = true; }, async query(sql, params) {
        assert.doesNotMatch(sql, /CREATE TABLE/);
        if (sql.includes('FROM ride_history')) return [[{ Ride_ID_Pk: 1, User_ID_Fk: 20, Driver_ID_Fk: 10, Ride_Status: status }]];
        if (sql.includes('FROM drivers')) return [[{ id: 10, User_ID_FK: driverUserId }]];
        if (sql.includes('INSERT INTO ride_reviews')) {
            assert.doesNotMatch(sql, /User_ID_FK/);
            writes.push(params); return [{ affectedRows: 1 }];
        }
        if (sql.includes('AVG')) { if (failAverage) throw new Error('database internal details'); return [[{ avg_rating: 4.5 }]]; }
        if (sql.includes('UPDATE drivers')) return [{ affectedRows: 1 }];
        throw new Error(sql);
    } };
    const deps = {
        '../db/Connect_Db': { getConnection: async () => conn }, '../socket/socketManager': {},
        '../services/pushNotificationService': {}, '../utils/driverHelper': {}, crypto: require('node:crypto'),
    };
    const context = { module: { exports: {} }, console: { error() {} }, require: id => id in deps ? deps[id] : require(path.resolve(__dirname, '..', 'controller', id)) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller/rideController.js'), 'utf8'), context);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
    await context.module.exports.submitReview({ user: { userId }, body: { ride_id: 1, rating: 4, feedback_tags: ['Smooth ride'], comment: 'Good', ...body } }, res);
    return { res, writes, committed, rolledBack, released };
}
test('customer review uses portable columns and commits review and average together', async () => {
    const f = await review(); assert.equal(f.res.body.success, true); assert.equal(f.committed, true);
    assert.equal(f.writes[0][3], 'User'); assert.equal(f.writes[0][2], 10); assert.equal(f.released, true);
});
test('assigned driver can review customer using authenticated user identity', async () => {
    const f = await review({ userId: 30 }); assert.equal(f.res.body.success, true); assert.equal(f.writes[0][3], 'Driver'); assert.equal(f.writes[0][2], 20);
});
test('unrelated users cannot submit or overwrite reviews', async () => {
    const f = await review({ userId: 999 }); assert.equal(f.res.statusCode, 403); assert.equal(f.writes.length, 0); assert.equal(f.rolledBack, true);
});
test('only completed rides can be reviewed', async () => {
    const f = await review({ status: 'Started' }); assert.equal(f.res.statusCode, 400); assert.equal(f.writes.length, 0);
});
for (const body of [{ ride_id: null }, { rating: 'bad' }, { rating: '4' }, { rating: 4.5 }, { rating: 6 }, { feedback_tags: {} }, { feedback_tags: [null] }, { comment: 'x'.repeat(501) }]) {
    test(`invalid review input is rejected: ${JSON.stringify(body).slice(0, 70)}`, async () => {
        const f = await review({ body }); assert.equal(f.res.statusCode, 400); assert.equal(f.writes.length, 0); assert.equal(f.released, false);
    });
}
test('failed average update rolls back review and returns a safe retry message', async () => {
    const f = await review({ failAverage: true }); assert.equal(f.res.statusCode, 500); assert.equal(f.rolledBack, true); assert.equal(f.committed, false); assert.equal(f.res.body.error, undefined);
});
