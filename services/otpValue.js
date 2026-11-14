const { createHash, timingSafeEqual } = require('node:crypto');

// New codes are stored as six digits, including leading zeros. Continue to
// accept unexpired SHA-256 records issued before this storage change.
function matchesOtp(submitted, stored) {
    if (typeof submitted !== 'string' || !/^\d{6}$/.test(submitted)) return false;
    const value = String(stored ?? '');
    let candidate;
    if (/^\d{6}$/.test(value)) candidate = submitted;
    else if (/^[a-f0-9]{64}$/.test(value)) candidate = createHash('sha256').update(submitted).digest('hex');
    else return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(value));
}
module.exports = { matchesOtp };
