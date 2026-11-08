const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SESSION_SECONDS = 8 * 60 * 60;
const INVALID_LOGIN = 'Invalid email, password, or security code.';
// Match existing bcrypt work even when no eligible account is found.
const DUMMY_HASH = bcrypt.hashSync('unused-admin-login-timing-value', 10);

function createAdminLogin({ pool, getSecret = () => process.env.JWT_SECRET }) {
    return async (req, res) => {
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
                `SELECT User_ID_Pk, User_Name, Email, Password, Role, AccountDeleted
                 FROM users WHERE Email = ? AND LOWER(TRIM(Role)) = 'admin'
                 ORDER BY User_ID_Pk ASC LIMIT 2`,
                [email.trim().toLowerCase()]
            );
            // Fail closed on ambiguous accounts and on unexpected DB response roles.
            const user = rows.length === 1 ? rows[0] : null;
            const eligible = user && String(user.Role || '').trim().toLowerCase() === 'admin' &&
                (user.AccountDeleted == null || Number(user.AccountDeleted) === 0);
            const hash = eligible && typeof user.Password === 'string' && /^\$2[aby]\$\d{2}\$/.test(user.Password)
                ? user.Password : DUMMY_HASH;
            const passwordValid = await bcrypt.compare(password, hash);
            if (!eligible || hash === DUMMY_HASH || !passwordValid || security_code !== '0000') {
                return res.status(401).json({ success: false, message: INVALID_LOGIN });
            }
            const token = jwt.sign({ userId: user.User_ID_Pk, role: 'admin' }, secret, {
                algorithm: 'HS256', expiresIn: SESSION_SECONDS,
            });
            const expiresAt = jwt.decode(token).exp * 1000;
            return res.json({
                success: true, message: 'Admin login successful.', token, expiresAt,
                user: { id: user.User_ID_Pk, name: user.User_Name, email: user.Email, role: 'admin' },
            });
        } catch (err) {
            console.error('Admin login failed:', err.code || 'INTERNAL_ERROR');
            return res.status(500).json({ success: false, message: 'Unable to sign in right now. Please try again.' });
        } finally {
            if (conn) conn.release();
        }
    };
}
module.exports = { createAdminLogin, SESSION_SECONDS };
