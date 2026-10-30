const jwt = require('jsonwebtoken');

/**
 * Admin Authentication Middleware
 * Secures administrative endpoints (such as push notification broadcasts).
 * Accepts:
 *  1. Header 'x-admin-api-key' or 'x-api-key' matching ADMIN_API_KEY
 *  2. Header 'Authorization: Bearer <ADMIN_API_KEY>'
 *  3. Header 'Authorization: Bearer <JWT_TOKEN>' where decoded.role === 'admin'
 */
const adminAuthMiddleware = (req, res, next) => {
    const configuredApiKey = process.env.ADMIN_API_KEY || 'goride_admin_secure_key_2026';

    // 1. Check custom API key headers
    const apiKeyHeader = req.headers['x-admin-api-key'] || req.headers['x-api-key'];
    if (apiKeyHeader && apiKeyHeader === configuredApiKey) {
        req.isAdmin = true;
        return next();
    }

    // 2. Check Authorization Bearer header
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
            const token = parts[1];

            // 2a. Direct API key passed as Bearer token
            if (token === configuredApiKey) {
                req.isAdmin = true;
                return next();
            }

            // 2b. JWT token with admin role
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_fallback_secret');
                const role = (decoded.role || decoded.Role || decoded.user_type || '').toLowerCase();
                if (role === 'admin' || role === 'superadmin' || decoded.isAdmin === true) {
                    req.user = decoded;
                    req.isAdmin = true;
                    return next();
                }
            } catch (err) {
                // Invalid or expired JWT
            }
        }
    }

    // 3. Fallback: Reject unauthorized request
    return res.status(401).json({
        success: false,
        message: "Unauthorized: Valid admin API key or admin token required."
    });
};

module.exports = adminAuthMiddleware;
