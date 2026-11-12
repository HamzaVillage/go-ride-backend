const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getAccess, createAccessMiddleware, SCREENS } = require('../services/employeeAccess');
const { createEmployeeService, validateEmployee, idOf, ids } = require('../services/adminEmployees');
const { createAdminLogin } = require('../services/adminAuth');
const mobileAuth = require('../utils/authMiddleware');
const adminSession = require('../utils/adminSessionMiddleware');
function flag(t, value = 'true') { const old = process.env.EMPLOYEE_ACCESS_ENABLED; process.env.EMPLOYEE_ACCESS_ENABLED = value; t.after(() => old === undefined ? delete process.env.EMPLOYEE_ACCESS_ENABLED : process.env.EMPLOYEE_ACCESS_ENABLED = old); }
function response() { return { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function fixture() {
    const state = { employee: { emp_id: 12, account_type:'employee', is_active: 1, is_deleted: 0 }, codes: ['drivers', 'support'], root: false, activeAccount: true, released: 0, queries: [] };
    const conn = { release() { state.released++; }, async query(sql, args) {
        state.queries.push({ sql, args });
        if (sql.includes('FROM employee WHERE emp_id')) return [state.activeAccount && state.employee ? [{...state.employee, account_type:state.root?'superadmin':state.employee.account_type}] : []];
        if (sql.includes('SELECT DISTINCT')) return [state.codes.map(function_code => ({ function_code }))];
        throw new Error(`Unexpected query: ${sql}`);
    } };
    const pool = { getConnection: async () => conn };
    return { state, conn, pool };
}
test('effective access uses live employee, role and screen flags and unions distinct grants', async () => {
    const f = fixture(); const access = await getAccess(f.conn, 9);
    assert.deepEqual(access, { employee_id: 12, is_super_admin: false, functions: ['drivers', 'support'] });
    const sql = f.state.queries.at(-1).sql;
    for (const alias of ['a', 'r', 'af', 'f']) { assert.match(sql, new RegExp(`${alias}\\.is_active = 1`)); assert.match(sql, new RegExp(`${alias}\\.is_deleted = 0`)); }
    assert.match(sql, /SELECT DISTINCT/);
    assert.deepEqual(f.state.queries[0].args, [9]);
});
test('inactive or deleted employees are denied even with unexpired credentials', async () => {
    for (const patch of [{ is_active: 0 }, { is_deleted: 1 }]) { const f = fixture(); Object.assign(f.state.employee, patch); await assert.rejects(getAccess(f.conn, 9), { status: 401 }); }
    const f = fixture(); f.state.activeAccount = false; await assert.rejects(getAccess(f.conn, 9), { status: 401 });
});
test('super administrators require an independent active employee record', async () => {
    const f = fixture(); f.state.root=true;
    const access=await getAccess(f.conn,9); assert.equal(access.is_super_admin,true); assert.equal(access.functions.length,SCREENS.length);
    f.state.employee=null; await assert.rejects(getAccess(f.conn,9),{status:401});
    assert.ok(f.state.queries.every(q=>!q.sql.includes('FROM users')));
});
test('unknown database function codes cannot grant arbitrary API access', async () => { const f = fixture(); f.state.codes = ['drivers', '*', 'unregistered']; assert.deepEqual((await getAccess(f.conn, 9)).functions, ['drivers']); });
test('permissions are reread per request; revocation and inactive roles do not rely on JWT claims', async t => {
    flag(t); const f = fixture(); const middleware = createAccessMiddleware(f.pool, 'drivers'); let allowed = 0;
    const req = { user: { employeeId: 9, auth_type: 'staff', role: 'employee', functions: ['drivers'] } };
    await middleware(req, response(), () => allowed++); assert.equal(allowed, 1);
    f.state.codes = []; const denied = response(); await middleware(req, denied, () => allowed++); assert.equal(denied.statusCode, 403); assert.equal(allowed, 1);
    f.state.employee.is_active = 0; const inactive = response(); await middleware(req, inactive, () => allowed++); assert.equal(inactive.statusCode, 401); assert.equal(f.state.released, 3);
});
test('disabled legacy feature flag cannot bypass employee authorization', async t => {
    flag(t,'false'); const f=fixture(); f.state.codes=[]; const res=response();
    await createAccessMiddleware(f.pool,'drivers')({user:{employeeId:9,auth_type:'staff',role:'employee'}},res,()=>{throw new Error('must not authorize');});
    assert.equal(res.statusCode,403); assert.ok(f.state.queries.length>0);
});
test('authorization database failures fail closed and release connections', async t => {
    flag(t); let released = false;
    const pool = { getConnection: async () => ({ query: async () => { throw Object.assign(new Error('private database details'), { code: 'PRIVATE' }); }, release() { released = true; } }) };
    const res = response(); await createAccessMiddleware(pool, 'drivers')({ user: { employeeId: 9, auth_type: 'staff' } }, res, () => { throw new Error('must not authorize'); });
    assert.equal(res.statusCode, 503); assert.equal(released, true); assert.doesNotMatch(JSON.stringify(res.body), /private database details|PRIVATE/);
});
const employeeBody = { name: 'Test Employee', email: 'staff@example.com', phone: '03001234567', cnic: '12345-1234567-1', father_name: 'Father', father_cnic: '12345-1234567-2', address: 'Test address', password: 'test-password-strong', role_ids: [3], is_active: true };
test('employee validation normalizes CNIC and rejects audit injection, weak passwords and malformed values before SQL', () => {
    const normalized = validateEmployee(employeeBody, true); assert.equal(normalized.cnic, '1234512345671'); assert.equal(normalized.password, undefined);
    for (const body of [{ ...employeeBody, created_by: 90 }, { ...employeeBody, password: 'short' }, { ...employeeBody, cnic: '1' }, { ...employeeBody, email: 'invalid' }, { ...employeeBody, is_active: 'false' }, { ...employeeBody, role_ids: [3, 3] }]) assert.throws(() => validateEmployee(body, true), { status: 400 });
    for (const value of [[1], true, {}, 0, -1, '1 OR 1=1', 1.5]) assert.throws(() => idOf(value), { status: 400 });
    assert.deepEqual(ids([3, '2']), [2, 3]);
});
function transactionFixture({ conflict = false, failAssignment = false } = {}) {
    const f = fixture(); f.state.root = true;
    Object.assign(f.state, { commits: 0, rollbacks: 0 });
    const query = f.conn.query.bind(f.conn);
    Object.assign(f.conn, { async beginTransaction() {}, async commit() { f.state.commits++; }, async rollback() { f.state.rollbacks++; }, async query(sql, args) {
        if (sql.includes('WHERE LOWER(TRIM(email))')) return [[]];
        if (/^(INSERT INTO|UPDATE) users/.test(sql)) throw new Error('Employee writes must never touch users');
        if (sql.startsWith('INSERT INTO employee ')) { f.state.employeeInsert = { sql, args }; return [{ insertId: 12 }]; }
        if (sql.includes('FROM employee_role WHERE role_id IN')) return [[{ role_id: 3 }]];
        if (sql.includes('FROM employee_function WHERE function_id IN')) return [[{ function_id: 2 }]];
        if (sql.startsWith('SELECT * FROM employee_role')) return [[{ role_id: 3, version: conflict ? 9 : 1 }]];
        if (sql.startsWith('UPDATE employee_role')) return [{ affectedRows: 1 }];
        if (sql.startsWith('UPDATE assign_role')) { f.state.removal = { sql, args }; return [{}]; }
        if (sql.startsWith('INSERT INTO assign_role')) { if (failAssignment) throw new Error('failed assignment'); f.state.assignment = { sql, args }; return [{}]; }
        if (sql.startsWith('SELECT emp_id, account_type, is_active')) return query(sql,args);
        if (sql.includes('FROM employee WHERE emp_id')) return [[{ emp_id: 12, account_type:'employee', name: 'Test Employee', is_active: 1, is_deleted: 0, version: 1 }]];
        if (sql.includes('FROM assign_role a')) return [[{ role_id: 3 }]];
        return query(sql, args);
    } });
    return f;
}
test('employee creation hashes credentials and records the authenticated actor in one transaction', async () => {
    const f = transactionFixture(); const result = await createEmployeeService(f.pool).saveEmployee(null, 7, employeeBody);
    assert.equal(result.emp_id, 12); assert.deepEqual(result.role_ids, [3]);
    const columns=f.state.employeeInsert.sql.match(/employee \((.+?), created_by/)[1].split(','); assert.equal(await bcrypt.compare(employeeBody.password, f.state.employeeInsert.args[columns.indexOf('password_hash')]), true); assert.equal(f.state.userInsert,undefined);
    assert.match(f.state.employeeInsert.sql, /created_by, updated_by/); assert.deepEqual(f.state.employeeInsert.args.slice(-2), [7, 7]);
    assert.match(f.state.assignment.sql, /ON DUPLICATE KEY UPDATE/); assert.equal(f.state.commits, 1); assert.equal(f.state.rollbacks, 0);
});
test('assignment failure rolls back both the employee and credential records', async () => {
    const f = transactionFixture({ failAssignment: true }); await assert.rejects(createEmployeeService(f.pool).saveEmployee(null, 7, employeeBody));
    assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1); assert.equal(f.state.released, 1);
});
test('role screen replacement soft-deletes removed grants and rejects stale versions', async () => {
    const f = transactionFixture(); await createEmployeeService(f.pool).saveRole(3, 7, { version: 1, function_ids: [2] });
    assert.match(f.state.removal.sql, /is_active = 0, is_deleted = 1/); assert.deepEqual(f.state.assignment.args, [3, 2, 7, 7]); assert.equal(f.state.commits, 1);
    const stale = transactionFixture({ conflict: true }); await assert.rejects(createEmployeeService(stale.pool).saveRole(3, 7, { version: 1, function_ids: [2] }), { status: 409 }); assert.equal(stale.state.assignment, undefined);
});
test('employee login issues a scoped eight-hour employee JWT and checks account status', async t => {
    flag(t); const f = fixture(); const hash = bcrypt.hashSync('employee-password', 10); const secret = 'employee-test-secret';
    const query = f.conn.query.bind(f.conn); f.conn.query = async (sql, args) => {
        if (sql.includes('FROM employee WHERE LOWER(TRIM(email))')) return [[{emp_id:12,name:'Staff',email:'staff@example.com',account_type:'employee',is_active:1,is_deleted:0,password_hash:hash}]];
        return query(sql, args);
    };
    const login = createAdminLogin({ pool: f.pool, getSecret: () => secret }); const res = response();
    const req = { body: { email: 'staff@example.com', password: 'employee-password', security_code: '0000' } };
    await login(req, res); const decoded = jwt.verify(res.body.token, secret); assert.equal(decoded.role, 'employee'); assert.equal(decoded.exp - decoded.iat, 28800); assert.equal(res.body.user.role, 'employee'); assert.equal(res.body.user.Password, undefined);
    f.state.employee.is_active = 0; const denied = response(); await login(req, denied); assert.equal(denied.statusCode, 401); assert.equal(denied.body.token, undefined);
    const old = process.env.JWT_SECRET; process.env.JWT_SECRET = secret; t.after(() => old === undefined ? delete process.env.JWT_SECRET : process.env.JWT_SECRET = old);
    const mobileRes = response(); mobileAuth({ headers: { authorization: `Bearer ${res.body.token}` } }, mobileRes, () => { throw new Error('employee token must not enter mobile APIs'); }); assert.equal(mobileRes.statusCode, 403);
    let allowed = false; adminSession({ headers: { authorization: `Bearer ${res.body.token}` } }, response(), () => allowed = true); assert.equal(allowed, true);
});

test('HTTP permission guards reject unassigned screens before listing data or accepting uploads', async t => {
    flag(t); const old = process.env.JWT_SECRET; process.env.JWT_SECRET = 'employee-http-test-secret'; t.after(() => old === undefined ? delete process.env.JWT_SECRET : process.env.JWT_SECRET = old);
    const express = require('express'); const { once } = require('node:events'); const { createAdminRouter } = require('../routers/admin'); const f = fixture();
    const app = express(); app.use(express.json()); app.use('/admin', createAdminRouter(f.pool));
    const server = app.listen(0, '127.0.0.1'); t.after(() => new Promise(resolve => server.close(resolve))); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`; const token = jwt.sign({ employeeId: 9, auth_type: 'staff', role: 'employee' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const headers = { Authorization: `Bearer ${token}` };
    for (const [path, method] of [['/admin/employees', 'GET'], ['/admin/employees/catalog', 'GET'], ['/admin/employees/12/documents/cnic_front', 'POST'], ['/admin/overview', 'GET']]) {
        const response = await fetch(origin + path, { method, headers }); assert.equal(response.status, 403); await response.json();
    }
    const allowed = await fetch(origin + '/admin/me', { headers }); assert.deepEqual((await allowed.json()).data.functions, ['drivers', 'support']);
    f.state.employee.is_active = 0; const revoked = await fetch(origin + '/admin/me', { headers }); assert.equal(revoked.status, 401);
    assert.ok(f.state.queries.every(({ sql }) => !sql.includes('COUNT(*)') && !sql.startsWith('INSERT') && !sql.startsWith('UPDATE')));
});

test('notification authorization cannot bypass employee grants using development fallback credentials', t => {
    const middleware = require('../utils/adminAuthMiddleware'); const oldKey = process.env.ADMIN_API_KEY, oldSecret = process.env.JWT_SECRET;
    delete process.env.ADMIN_API_KEY; delete process.env.JWT_SECRET;
    t.after(() => { if (oldKey === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = oldKey; if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
    for (const headers of [{ 'x-admin-api-key': 'goride_admin_secure_key_2026' }, { authorization: 'Bearer goride_admin_secure_key_2026' }, { authorization: `Bearer ${jwt.sign({ userId: 1, role: 'admin' }, 'your_fallback_secret')}` }]) {
        const res = response(); middleware({ headers }, res, () => { throw new Error('Unconfigured credentials must not authorize.'); }); assert.equal(res.statusCode, 401);
    }
});

test('ordinary employees cannot create or promote super administrators',async()=>{
    const f=transactionFixture();f.state.root=false;f.state.codes=['employees'];
    await assert.rejects(createEmployeeService(f.pool).saveEmployee(null,7,{...employeeBody,account_type:'superadmin'}),{status:403});
    assert.equal(f.state.employeeInsert,undefined);
});
test('super administrator creation stores its own credentials only in employee',async()=>{
    const f=transactionFixture();await createEmployeeService(f.pool).saveEmployee(null,7,{...employeeBody,account_type:'superadmin'});
    assert.match(f.state.employeeInsert.sql,/password_hash/);assert.ok(f.state.employeeInsert.args.includes('superadmin'));
    assert.equal(f.state.userInsert,undefined);
    assert.ok(f.state.queries.every(q=>!q.sql.includes('FROM users')));
});
test('legacy admin user tokens never become employee sessions even with matching numeric IDs',t=>{
    const old=process.env.JWT_SECRET;process.env.JWT_SECRET='separate-staff-id-test';t.after(()=>old===undefined?delete process.env.JWT_SECRET:process.env.JWT_SECRET=old);
    for(const claims of [{userId:12,role:'admin'},{userId:12,role:'employee'},{employeeId:12,role:'admin'}]){
        const res=response();adminSession({headers:{authorization:'Bearer '+jwt.sign(claims,process.env.JWT_SECRET)}},res,()=>{throw new Error('legacy token cannot authorize staff');});assert.equal(res.statusCode,401);
    }
});
