const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createCityToCityAuth, phoneNumber } = require('../services/cityToCityAuth');
function fixture({ attempts = 0, expired = false, role = 'rider', recent = false } = {}) {
    const state = { commits: 0, rollbacks: 0, consumed: false, attempts, queries: [] };
    const conn = { async beginTransaction() {}, async commit() { state.commits++; }, async rollback() { state.rollbacks++; }, release() {}, async query(sql,args) {
        state.queries.push({ sql,args });
        if (sql.includes('FROM users u JOIN')) return [[{ User_ID_Pk: 7, User_Name: 'Ali', Mobile: '03001234567', Role: role, AccountDeleted: 0 }]];
        if (sql.includes('FROM ride_history')) return [[]];
        if (sql.includes('created_at >')) return [recent ? [{ id: 1 }] : []];
        if (sql.includes('SELECT id,otp_hash')) return [expired || state.consumed ? [] : [{ id: 1, otp_hash: createHash('sha256').update('123456').digest('hex'), attempts: state.attempts }]];
        if (sql.startsWith('UPDATE otp_verifications')) state.attempts++;
        if (sql.startsWith('DELETE')) state.consumed = true;
        return [{}];
    } };
    return { state, service: createCityToCityAuth({ pool: { getConnection: async () => conn }, sendOtp: async () => '123456', signToken: claims => { assert.equal(claims.role, 'rider'); assert.equal(claims.userId, 7); return 'signed-token'; } }) };
}
test('city-to-city OTP login consumes its own code and preserves personal-account identity', async () => {
    const f = fixture();
    const result = await f.service.verify({ phone: '03001234567', otp: '123456' });
    assert.equal(result.token, 'signed-token'); assert.equal(result.user.id, 7);
    await assert.rejects(f.service.verify({ phone: '03001234567', otp: '123456' }), { status: 400 });
    assert.ok(f.state.queries.filter(q => q.sql.includes('otp_verifications')).every(q => q.args.includes('city_to_city_login')));
});
test('incorrect attempt commits its counter; expired, exhausted and privileged logins fail', async () => {
    const invalid = fixture();
    await assert.rejects(invalid.service.verify({ phone: '03001234567', otp: '000000' }), { status: 400 });
    assert.equal(invalid.state.attempts, 1); assert.equal(invalid.state.commits, 1); assert.equal(invalid.state.rollbacks, 0);
    for (const setup of [{ expired: true },{ attempts: 5 }]) await assert.rejects(fixture(setup).service.verify({ phone: '03001234567', otp: '123456' }), { status: 400 });
    await assert.rejects(fixture({ role: 'admin' }).service.verify({ phone: '03001234567', otp: '123456' }), { status: 403 });
});
test('send hashes codes without returning them and enforces resend cooldown', async () => {
    const f = fixture();
    const response = await f.service.send({ phone: '+92 3001234567' });
    assert.equal(response.otp, undefined);
    const insert = f.state.queries.find(q => q.sql.startsWith('INSERT INTO otp_verifications'));
    assert.notEqual(insert.args[1], '123456'); assert.equal(insert.args[1].length, 64);
    await assert.rejects(fixture({ recent: true }).service.send({ phone: '03001234567' }), { status: 429 });
    assert.throws(() => phoneNumber('123'), { status: 400 });
});
