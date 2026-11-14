const { fail } = require('./employeeAccess');
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
function feeSettings(rate = {}) {
    const bit = rate.Platform_Fee_Is_Percentage ?? 1;
    if (![true, false, 0, 1, '0', '1'].includes(bit)) throw fail(503, 'Invalid platform fee mode.');
    const percentage = Number(bit) === 1;
    const value = Number(percentage ? rate.Fee_Percentage ?? 0 : rate.Platform_Fee_RS ?? 0);
    if (!Number.isFinite(value) || value < 0 || (percentage && value > 100)) throw fail(503, 'Invalid platform fee configuration.');
    return { percentage, value };
}
// Existing quotes include an organization fee added to the underlying ride fare.
// Booking extracts that included fee; completion always uses the saved amount.
function includedPlatformFee(rate, total) {
    total = Number(total);
    if (!Number.isFinite(total) || total < 0) throw fail(400, 'Enter a valid ride fare.');
    const { percentage, value } = feeSettings(rate);
    const fee = percentage ? money(total - total / (1 + value / 100)) : money(value);
    if (fee > total) throw fail(400, 'Ride fare must cover the platform fee.');
    return { fee, percentage: percentage ? value : 0, mode: percentage ? 'percentage' : 'fixed' };
}
function addedPlatformFee(rate, subtotal) {
    const { percentage, value } = feeSettings(rate);
    return { fee: money(percentage ? Number(subtotal) * value / 100 : value), percentage: percentage ? value : 0, mode: percentage ? 'percentage' : 'fixed' };
}
module.exports = { feeSettings, includedPlatformFee, addedPlatformFee };
