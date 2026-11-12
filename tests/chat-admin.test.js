const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const admin = require('../utils/chatAdminAuthMiddleware');

test('chat reports reject fallback credentials and rider JWTs; configured admin credentials work', () => {
    const oldKey = process.env.ADMIN_API_KEY;
    const oldSecret = process.env.JWT_SECRET;
    try {
        delete process.env.ADMIN_API_KEY;
        delete process.env.JWT_SECRET;
        const check = headers => {
            let allowed = false;
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
            admin({ headers }, res, () => { allowed = true; });
            return { allowed, status: res.statusCode };
        };
        assert.equal(check({ 'x-admin-api-key': 'goride_admin_secure_key_2026' }).status, 401);
        process.env.JWT_SECRET = 'test-only-admin-secret';
        const rider = jwt.sign({ userId: 99, role: 'rider' }, process.env.JWT_SECRET);
        assert.equal(check({ authorization: `Bearer ${rider}` }).allowed, false);
        const token = jwt.sign({ employeeId: 1, auth_type:'staff', role: 'admin' }, process.env.JWT_SECRET);
        assert.equal(check({ authorization: `Bearer ${token}` }).allowed, true);
        process.env.ADMIN_API_KEY = 'test-only-admin-key';
        assert.equal(check({ 'x-admin-api-key': process.env.ADMIN_API_KEY }).allowed, true);
    } finally {
        if (oldKey === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = oldKey;
        if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    }
});
