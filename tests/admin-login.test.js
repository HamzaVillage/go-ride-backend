const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const { once } = require('node:events');
const { createAdminLogin, SESSION_SECONDS } = require('../services/adminAuth');
const createLimiter = require('../utils/adminLoginLimiter');
const chatAdmin = require('../utils/chatAdminAuthMiddleware');
const notificationAdmin = require('../utils/adminAuthMiddleware');
const secret = 'test-only-admin-login-signing-secret';
const password = 'correct-test-password';
const user = { User_ID_Pk: 7, User_Name: 'Test Admin', Email: 'admin@example.com', Role: 'admin', AccountDeleted: 0, Password: bcrypt.hashSync(password, 10) };
const credentials = { email: 'admin@example.com', password, security_code: '0000' };
function fixture({ rows = [user], secretValue = secret, failure } = {}) {
    let released = false; const queries = [];
    const pool = { getConnection: async () => ({ release() { released = true; }, async query(sql, params) { queries.push({ sql, params }); if (failure) throw Object.assign(new Error('internal database details'), {code:'TEST_DB_FAILURE'}); return [rows]; } }) };
    return { handler: createAdminLogin({ pool, getSecret: () => secretValue }), queries, get released() { return released; } };
}
async function invoke(f, body = credentials) {
    const res = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await f.handler({ body }, res); return res;
}
test('admin email/password/0000 login returns an eight-hour admin JWT with safe profile', async () => {
    const f = fixture(); const res = await invoke(f, { ...credentials, email:' Admin@Example.COM ' });
    assert.equal(res.statusCode, 200); assert.equal(res.body.success, true);
    const decoded = jwt.verify(res.body.token, secret, { algorithms:['HS256'] });
    assert.equal(decoded.role, 'admin'); assert.equal(decoded.userId, 7);
    assert.equal(decoded.exp - decoded.iat, SESSION_SECONDS); assert.equal(res.body.expiresAt, decoded.exp * 1000);
    assert.deepEqual(res.body.user, { id:7, name:'Test Admin', email:'admin@example.com', role:'admin' });
    assert.equal(res.body.Password, undefined); assert.equal(res.body.user.Password, undefined);
    assert.deepEqual(f.queries[0].params, ['admin@example.com']); assert.match(f.queries[0].sql, /LOWER\(TRIM\(Role\)\) = 'admin'/);
    assert.match(res.headers['Cache-Control'], /no-store/); assert.equal(f.released, true);
});
for (const [name, rows, body] of [
    ['wrong password', [user], { ...credentials, password:'wrong' }],
    ['wrong four-digit code', [user], { ...credentials, security_code:'1234' }],
    ['missing account', [], credentials],
    ['rider role', [{...user,Role:'rider'}], credentials],
    ['driver role', [{...user,Role:'driver'}], credentials],
    ['superadmin role', [{...user,Role:'superadmin'}], credentials],
    ['deleted account', [{...user,AccountDeleted:1}], credentials],
    ['duplicate admin email', [user,user], credentials],
    ['missing hash', [{...user,Password:null}], credentials],
    ['plaintext password', [{...user,Password:password}], credentials],
]) test(`admin login denies ${name}`, async () => {
    const f = fixture({rows}); const res = await invoke(f, body);
    assert.equal(res.statusCode, 401); assert.equal(res.body.token, undefined);
    assert.equal(res.body.message, 'Invalid email, password, or security code.'); assert.equal(f.released, true);
});
for (const body of [null, {}, {...credentials,email:[]}, {...credentials,email:'not-an-email'}, {...credentials,password:{}}, {...credentials,password:''}, {...credentials,password:'a'.repeat(73)}, {...credentials,security_code:0}, {...credentials,security_code:'000'}, {...credentials,security_code:'00000'}]) {
    test(`admin login validates input ${JSON.stringify(body)?.slice(0,100)}`, async () => {
        const f = fixture(); const res = await invoke(f,body);
        assert.equal(res.statusCode,400); assert.equal(f.queries.length,0);
    });
}
test('admin login requires configured JWT_SECRET and never uses a fallback', async () => {
    const f = fixture({secretValue:''}); const res = await invoke(f);
    assert.equal(res.statusCode,503); assert.equal(f.queries.length,0); assert.equal(res.body.token,undefined);
});
test('database failures release connections and do not expose internals', async () => {
    const f = fixture({failure:true}); const res = await invoke(f);
    assert.equal(res.statusCode,500); assert.equal(f.released,true);
    assert.doesNotMatch(JSON.stringify(res.body), /internal database details|TEST_DB_FAILURE/);
});
test('issued admin JWT authorizes both reports and notifications', async () => {
    const oldSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = secret;
    try {
        const res = await invoke(fixture());
        for (const middleware of [chatAdmin,notificationAdmin]) {
            let allowed = false;
            middleware({headers:{authorization:`Bearer ${res.body.token}`}}, {status(){throw new Error('unexpected rejection');}}, () => { allowed = true; });
            assert.equal(allowed,true);
        }
    } finally { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; }
});
test('HTTP endpoint blocks repeated failures and returns Retry-After', async t => {
    const app = express(); app.use(express.json()); app.post('/auth/admin-login', createLimiter(), fixture({rows:[]}).handler);
    const server = app.listen(0, '127.0.0.1'); t.after(() => new Promise(resolve => server.close(resolve))); await once(server,'listening');
    const url = `http://127.0.0.1:${server.address().port}/auth/admin-login`;
    for (let i = 0; i < 10; i++) {
        const response = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
        assert.equal(response.status,401); await response.json();
    }
    const blocked = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
    assert.equal(blocked.status,429); assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal((await blocked.json()).success,false);
});
