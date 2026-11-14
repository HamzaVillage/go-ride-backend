const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { matchesOtp } = require('../services/otpValue');
test('six-digit OTPs preserve leading zeros and reject mismatches', () => {
    assert.equal(matchesOtp('001234', '001234'), true);
    for (const value of ['001235', '1234', '', null, undefined, {}, ' '.repeat(6)]) {
        assert.equal(matchesOtp('001234', value), false);
    }
    assert.equal(matchesOtp(123456, '123456'), false);
    assert.equal(matchesOtp('12345', '12345'), false);
});
test('legacy SHA-256 codes match only the original six digits', () => {
    const old = createHash('sha256').update('001234').digest('hex');
    assert.equal(matchesOtp('001234', old), true);
    assert.equal(matchesOtp('001235', old), false);
});
