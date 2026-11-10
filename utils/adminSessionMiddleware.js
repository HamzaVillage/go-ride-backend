const jwt = require('jsonwebtoken');
module.exports = (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (token && process.env.JWT_SECRET) {
        try {
            const user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
            if (['admin', 'employee'].includes(user.role) && Number.isSafeInteger(Number(user.userId)) && Number(user.userId) > 0) {
                req.user = { ...user, userId: Number(user.userId) };
                return next();
            }
        } catch { /* Reject invalid and expired tokens. */ }
    }
    return res.status(401).json({ success: false, message: 'Sign in with an admin account to continue.' });
};
