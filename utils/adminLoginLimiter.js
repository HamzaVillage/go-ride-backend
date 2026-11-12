const { rateLimit } = require('express-rate-limit');

// Only direct, explicitly local development requests bypass lockout. Requests
// arriving through ngrok/reverse proxies retain the normal public login limit.
function isDirectLocalDevelopment(req) {
    if (process.env.NODE_ENV === 'production' || process.env.ADMIN_LOCAL_LOGIN_BYPASS !== 'true') return false;
    const address = req.socket?.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host || '')) return false;
    return !['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'].some(key => req.headers[key]);
}
module.exports = () => rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skip: isDirectLocalDevelopment,
    // Backend failures do not consume the failed-credential allowance.
    requestWasSuccessful: (_req, res) => res.statusCode !== 400 && res.statusCode !== 401,
    message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
});
module.exports.isDirectLocalDevelopment = isDirectLocalDevelopment;
