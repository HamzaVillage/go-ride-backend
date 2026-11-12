const jwt = require('jsonwebtoken');
const maintenance = require('./staffMaintenance');
module.exports = (req, res, next) => {
    if (maintenance.active()) return maintenance.middleware(req,res,next);
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (token && process.env.JWT_SECRET) {
        try {
            const user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
            if (user.auth_type === 'staff' && ['admin', 'employee'].includes(user.role) && Number.isSafeInteger(Number(user.employeeId)) && Number(user.employeeId) > 0) {
                req.user = { ...user, employeeId: Number(user.employeeId) };
                return next();
            }
        } catch { /* Reject invalid and expired tokens. */ }
    }
    return res.status(401).json({ success: false, message: 'Sign in with an admin account to continue.' });
};
