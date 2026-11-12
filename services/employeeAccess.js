const SCREENS = Object.freeze([
    ['overview', 'Overview', '/'], ['rides', 'Rides', '/rides'], ['drivers', 'Drivers', '/drivers'],
    ['riders', 'Riders', '/riders'], ['franchises', 'Franchises', '/franchises'],
    ['reports', 'Chat reports', '/reports'], ['support', 'Support queries', '/support'],
    ['notifications', 'Notifications', '/notifications'], ['settings', 'Settings', '/settings'],
    ['employees', 'Employee access', '/employees'],
    ['city_to_city_drivers','City-to-City Drivers','/drivers/city-to-city'],
    ['city_to_city_fares','City-to-City Service & Fares','/city-to-city/fares'],
    ['city_to_city_routes','City-to-City Route Fares','/city-to-city/routes'],
    ['city_to_city_calculator','City-to-City Fare Calculator','/city-to-city/calculator'],
    ['franchise_members','Franchise Drivers & Riders','/franchise-members'],
]);
const fail = (status, message) => Object.assign(new Error(message), { status });
async function getAccess(conn, employeeId, { lock = false } = {}) {
    const locking = lock ? ' LOCK IN SHARE MODE' : '';
    const [employees] = await conn.query('SELECT emp_id, account_type, is_active, is_deleted FROM employee WHERE emp_id = ?' + locking, [employeeId]);
    const employee = employees[0];
    if (!employee || !Number(employee.is_active) || Number(employee.is_deleted)) throw fail(401, 'This employee account is inactive or unavailable.');
    if (employee.account_type === 'superadmin') return { is_super_admin: true, employee_id: Number(employee.emp_id), functions: SCREENS.map(([code]) => code) };
    if (employee.account_type !== 'employee') throw fail(401, 'Invalid employee account type.');
    const [functions] = await conn.query(`SELECT DISTINCT f.function_code FROM assign_role a
        JOIN employee_role r ON r.role_id = a.role_id AND r.is_active = 1 AND r.is_deleted = 0
        JOIN assign_role_function af ON af.role_id = r.role_id AND af.is_active = 1 AND af.is_deleted = 0
        JOIN employee_function f ON f.function_id = af.function_id AND f.is_active = 1 AND f.is_deleted = 0
        WHERE a.emp_id = ? AND a.is_active = 1 AND a.is_deleted = 0${locking}`, [employee.emp_id]);
    return { is_super_admin: false, employee_id: employee.emp_id, functions: functions.map(row => row.function_code).filter(code => SCREENS.some(([known]) => known === code)) };
}
function createAccessMiddleware(pool, screen) {
    return async (req, res, next) => {
        let conn;
        try {
            conn = await pool.getConnection();
            req.access = await getAccess(conn, req.user.employeeId);
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
        return createAccessMiddleware(require('../db/Connect_Db'), screen)(req, res, next);
    });
}
module.exports = { SCREENS, fail, getAccess, createAccessMiddleware, withScreenAccess };
