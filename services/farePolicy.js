const { fail } = require('./employeeAccess');
const DEFAULT_POLICY = Object.freeze({
    peak_enabled: true,
    peak_windows: [{ start: '08:00', end: '11:00', days: [0, 1, 2, 3, 4, 5, 6] }, { start: '17:00', end: '20:00', days: [0, 1, 2, 3, 4, 5, 6] }],
    night_enabled: true, night_start: '22:00', night_end: '06:00', included_km: 1, round_to: 10,
});
const keys = Object.keys(DEFAULT_POLICY);
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
function time(value) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw fail(400, 'Use a valid 24-hour time (HH:mm).');
    return value;
}
function decimal(value, label, max = 999999.99, min = 0, integer = false) {
    if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max || (integer && !Number.isInteger(Number(value)))) throw fail(400, `${label} must be ${integer ? 'a whole number' : 'a number with at most two decimal places'} between ${min} and ${max}.`);
    return Number(value);
}
function validatePolicy(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw fail(400, 'Send the complete fare schedule and rounding policy.');
    if (typeof value.peak_enabled !== 'boolean' || typeof value.night_enabled !== 'boolean') throw fail(400, 'Peak/night switches must be true or false.');
    if (!Array.isArray(value.peak_windows) || value.peak_windows.length > 8 || (value.peak_enabled && !value.peak_windows.length)) throw fail(400, 'Configure between one and eight peak windows, or turn peak pricing off.');
    const peak_windows = value.peak_windows.map(window => {
        if (!window || Object.keys(window).some(key => !['start', 'end', 'days'].includes(key))) throw fail(400, 'Invalid peak window.');
        const start = time(window.start), end = time(window.end);
        if (start === end || !Array.isArray(window.days) || !window.days.length || window.days.length > 7 || window.days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(window.days).size !== window.days.length) throw fail(400, 'Each peak window needs different start/end times and unique weekdays.');
        return { start, end, days: [...window.days].sort((a, b) => a - b) };
    });
    const night_start = time(value.night_start), night_end = time(value.night_end);
    if (night_start === night_end) throw fail(400, 'Night start and end must be different.');
    return { peak_enabled: value.peak_enabled, peak_windows, night_enabled: value.night_enabled, night_start, night_end,
        included_km: decimal(value.included_km, 'Included kilometers', 100, 0), round_to: decimal(value.round_to, 'Rounding increment', 1000, 0.01) };
}
async function loadFarePolicy(conn, { strict = false, lock = false, withStorage = false } = {}) {
    const fallback = () => {
        const policy = structuredClone(DEFAULT_POLICY);
        return withStorage ? { policy, editable: false } : policy;
    };
    try {
        const [rows] = await conn.query(`SELECT policy_json FROM fare_policy WHERE id = 1${lock ? ' FOR UPDATE' : ''}`);
        if (!rows.length) {
            if (strict) throw fail(503, 'Custom peak/night schedule storage is unavailable. Existing vehicle rates remain editable.');
            return fallback();
        }
        const policy = validatePolicy(typeof rows[0].policy_json === 'string' ? JSON.parse(rows[0].policy_json) : rows[0].policy_json);
        return withStorage ? { policy, editable: true } : policy;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE' && !strict) return fallback();
        if (error.code === 'ER_NO_SUCH_TABLE') throw fail(503, 'Custom peak/night schedule storage is unavailable. Existing vehicle rates remain editable.');
        throw error;
    }
}

function scheduleStatus(policy, at = new Date()) {
    if (!Number.isFinite(at.getTime())) throw fail(400, 'Invalid preview date/time.');
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(part => [part.type, part.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), minute = Number(parts.hour) * 60 + Number(parts.minute);
    const inside = (start, end, days) => {
        const a = minutes(start), b = minutes(end);
        return a < b ? days.includes(day) && minute >= a && minute < b : (days.includes(day) && minute >= a) || (days.includes((day + 6) % 7) && minute < b);
    };
    return { isPeak: policy.peak_enabled && policy.peak_windows.some(window => inside(window.start, window.end, window.days)),
        isNight: policy.night_enabled && inside(policy.night_start, policy.night_end, [0, 1, 2, 3, 4, 5, 6]) };
}
function calculateEstimatedFare(rate, distance, duration, isPeak, isNight, waiting = 0, policy = DEFAULT_POLICY) {
    const minimum = Number(rate.Minimum_Distance ?? 1);
    const billedDistance = Math.max(distance, minimum);
    const extra = Math.max(0, billedDistance - policy.included_km);
    const base_fare = Number(rate.Base_Fare), distance_fare = extra * Number(rate.Per_Km_Rate), time_fare = duration * Number(rate.Per_Minute_Rate), waiting_charges = waiting * Number(rate.Per_Minute_Rate);
    const subtotal = base_fare + distance_fare + time_fare + waiting_charges;
    const night_charge = isNight ? subtotal * Number(rate.Night_Charge_Percent || 0) / 100 : 0;
    const peak_hour_surcharge = isPeak ? subtotal * Number(rate.Peak_Hours_Percent || 0) / 100 : 0;
    const fee_percentage = Number(rate.Fee_Percentage || 0), organization_fee = (subtotal + night_charge + peak_hour_surcharge) * fee_percentage / 100;
    const cents = (subtotal + night_charge + peak_hour_surcharge + organization_fee) * 100;
    const increment = Math.round(policy.round_to * 100);
    return { total_fare: Math.ceil((cents - 1e-7) / increment) * increment / 100, base_fare, distance_fare, time_fare, waiting_charges, night_charge, peak_hour_surcharge, fee_percentage, organization_fee, additional_kms: extra, billed_distance: billedDistance };
}
module.exports = { DEFAULT_POLICY, validatePolicy, loadFarePolicy, scheduleStatus, calculateEstimatedFare, decimal };
