const SCREENS = Object.freeze([
    ['overview', 'Overview', '/'], ['rides', 'Rides', '/rides'], ['drivers', 'Drivers', '/drivers'],
    ['riders', 'Riders', '/riders'], ['franchises', 'Franchises', '/franchises'],
    ['reports', 'Chat reports', '/reports'], ['support', 'Support queries', '/support'],
    ['notifications', 'Notifications', '/notifications'], ['settings', 'Settings', '/settings'],
    ['employees', 'Employee access', '/employees'],
]);
const enabled = () => process.env.EMPLOYEE_ACCESS_ENABLED === 'true';
const fail = (status, message) => Object.assign(new Error(message), { status });
async function getAccess(conn, userId, { lock = false } = {}) {
    const locking = lock ? ' LOCK IN SHARE MODE' : '';
    const [accounts] = await conn.query("SELECT User_ID_Pk, Role FROM users WHERE User_ID_Pk = ? AND LOWER(TRIM(Role)) IN ('admin', 'employee') AND COALESCE(AccountDeleted,0) = 0" + locking, [userId]);
    if (!accounts.length) throw fail(401, 'This admin account is no longer available.');
    const [employees] = await conn.query('SELECT emp_id, is_active, is_deleted FROM employee WHERE user_id = ?' + locking, [userId]);
    if (!employees.length && String(accounts[0].Role).trim().toLowerCase() !== 'admin') throw fail(401, 'Employee profile is unavailable.');
    if (!employees.length) return { is_super_admin: true, employee_id: null, functions: SCREENS.map(([code]) => code) };
    const employee = employees[0];
    if (!employee.is_active || employee.is_deleted) throw fail(401, 'This employee account is inactive. Contact your administrator.');
    const [functions] = await conn.query(`SELECT DISTINCT f.function_code FROM assign_role a
        JOIN employee_role r ON r.role_id = a.role_id AND r.is_active = 1 AND r.is_deleted = 0
        JOIN assign_role_function af ON af.role_id = r.role_id AND af.is_active = 1 AND af.is_deleted = 0
        JOIN employee_function f ON f.function_id = af.function_id AND f.is_active = 1 AND f.is_deleted = 0
        WHERE a.emp_id = ? AND a.is_active = 1 AND a.is_deleted = 0${locking}`, [employee.emp_id]);
    return { is_super_admin: false, employee_id: employee.emp_id, functions: functions.map(row => row.function_code).filter(code => SCREENS.some(([known]) => known === code)) };
}
function createAccessMiddleware(pool, screen) {
    return async (req, res, next) => {
        if (!enabled()) {
            if (req.user.role === 'employee') return res.status(401).json({ success: false, message: 'Employee access is not enabled.' });
            if (screen === 'employees') return res.status(503).json({ success: false, message: 'Apply the employee-access migration and enable EMPLOYEE_ACCESS_ENABLED first.' });
            req.access = { is_super_admin: true, employee_id: null, functions: SCREENS.map(([code]) => code) };
            return next();
        }
        let conn;
        try {
            conn = await pool.getConnection();
            req.access = await getAccess(conn, req.user.userId);
            if (screen && !req.access.functions.includes(screen)) throw fail(403, 'Your roles do not allow access to this screen.');
            next();
        } catch (error) {
            if (!error.status) console.error('Employee authorization failed:', error.code || 'INTERNAL_ERROR');
            res.status(error.status || 503).json({ success: false, message: error.status ? error.message : 'Unable to verify access. Please try again.' });
        } finally { conn?.release(); }
    };
}
// Legacy configured service keys remain available to their existing integrations.
// Signed admin sessions always pass through current, database-backed permissions.
function withScreenAccess(legacyMiddleware, screen) {
    return (req, res, next) => legacyMiddleware(req, res, () => {
        if (!req.user) return next();
        if (!enabled() && req.user.role !== 'employee') return next();
        return createAccessMiddleware(require('../db/Connect_Db'), screen)(req, res, next);
    });
}
module.exports = { SCREENS, enabled, fail, getAccess, createAccessMiddleware, withScreenAccess };
