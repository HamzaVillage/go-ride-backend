const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) return res.status(401).json({ success: false, message: "Access denied. No token provided." });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_fallback_secret');
        req.user = decoded;
        next();
    } catch (ex) {
        res.status(400).json({ success: false, message: "Invalid token." });
    }
};

module.exports = authMiddleware;
