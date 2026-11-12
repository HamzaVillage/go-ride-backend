const bcrypt = require('bcryptjs');
const maintenance = require('../utils/staffMaintenance');
const jwt = require('jsonwebtoken');
const { getAccess } = require('./employeeAccess');

const SESSION_SECONDS = 8 * 60 * 60;
const INVALID_LOGIN = 'Invalid email, password, or security code.';
// Match existing bcrypt work even when no eligible account is found.
const DUMMY_HASH = bcrypt.hashSync('unused-admin-login-timing-value', 10);

function createAdminLogin({ pool, getSecret = () => process.env.JWT_SECRET }) {
    return async (req, res) => {
        if (maintenance.active()) return maintenance.middleware(req,res,()=>{});
        res.set('Cache-Control', 'no-store, private');
        const { email, password, security_code } = req.body || {};
        if (typeof email !== 'string' || email.trim().length > 100 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
            typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72 ||
            typeof security_code !== 'string' || !/^\d{4}$/.test(security_code)) {
            return res.status(400).json({ success: false, message: 'Enter a valid email, password, and four-digit security code.' });
        }
        const secret = getSecret();
        if (typeof secret !== 'string' || !secret.trim()) {
            return res.status(503).json({ success: false, message: 'Admin login is not configured. Please contact the server administrator.' });
        }
        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query(
                'SELECT emp_id, name, email, password_hash, account_type, is_active, is_deleted FROM employee WHERE LOWER(TRIM(email)) = ? ORDER BY emp_id ASC LIMIT 2',
                [email.trim().toLowerCase()]
            );
            const user = rows.length === 1 ? rows[0] : null;
            const eligible = user && ['superadmin', 'employee'].includes(user.account_type) && Number(user.is_active) === 1 && Number(user.is_deleted) === 0;
            const hash = eligible && typeof user.password_hash === 'string' && /^\$2[aby]\$\d{2}\$/.test(user.password_hash)
                ? user.password_hash : DUMMY_HASH;
            const passwordValid = await bcrypt.compare(password, hash);
            if (!eligible || hash === DUMMY_HASH || !passwordValid || security_code !== '0000') {
                return res.status(401).json({ success: false, message: INVALID_LOGIN });
            }
            await getAccess(conn, user.emp_id);
            const role = user.account_type === 'superadmin' ? 'admin' : 'employee';
            const token = jwt.sign({ employeeId: Number(user.emp_id), auth_type: 'staff', role }, secret, {
                algorithm: 'HS256', expiresIn: SESSION_SECONDS,
            });
            const expiresAt = jwt.decode(token).exp * 1000;
            return res.json({
                success: true, message: 'Admin login successful.', token, expiresAt,
                user: { id: Number(user.emp_id), name: user.name, email: user.email, role },
            });
        } catch (err) {
            if (err.status === 401) return res.status(401).json({ success: false, message: INVALID_LOGIN });
            console.error('Admin login failed:', err.code || 'INTERNAL_ERROR');
            return res.status(500).json({ success: false, message: 'Unable to sign in right now. Please try again.' });
        } finally {
            if (conn) conn.release();
        }
    };
}
module.exports = { createAdminLogin, SESSION_SECONDS };
