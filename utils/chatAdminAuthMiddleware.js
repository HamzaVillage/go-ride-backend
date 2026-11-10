const jwt = require('jsonwebtoken');
const { timingSafeEqual } = require('node:crypto');
const same = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const left = Buffer.from(a); const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
};

// Chat reports must never accept the legacy middleware's development fallback keys.
module.exports = (req, res, next) => {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const key = process.env.ADMIN_API_KEY;
    if (key && same(req.headers['x-admin-api-key'] || req.headers['x-api-key'] || bearer, key)) return next();
    if (process.env.JWT_SECRET && bearer) {
        try {
            const user = jwt.verify(bearer, process.env.JWT_SECRET);
            if (['admin', 'superadmin', 'employee'].includes(String(user.role || '').toLowerCase()) || user.isAdmin === true) {
                req.user = user;
                return next();
            }
        } catch { /* Reject invalid or expired admin credentials. */ }
    }
    return res.status(401).json({ success: false, message: 'Configured admin credentials are required to view chat reports.' });
};
