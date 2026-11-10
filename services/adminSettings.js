const { createHash } = require('node:crypto');
const { fail, enabled: employeeAccessEnabled, getAccess } = require('./employeeAccess');
const { validatePolicy, loadFarePolicy, decimal, scheduleStatus, calculateEstimatedFare } = require('./farePolicy');
const SERVICE_FLAGS = ['ride_service', 'courier_service', 'food_delivery_service', 'grocery_service', 'fare_increaser'];
const CONFIG_KEYS = [...SERVICE_FLAGS, 'dispatch_min_radius_km', 'dispatch_radius_km'];
const RATE_FIELDS = {
    Base_Fare: ['Base fare', 999999.99], Per_Km_Rate: ['Per-km rate', 999999.99], Per_Minute_Rate: ['Per-minute rate', 999999.99],
    Fee_Percentage: ['Organization fee', 100], Night_Charge_Percent: ['Night surcharge', 500, 0, true], Peak_Hours_Percent: ['Peak surcharge', 500, 0, true],
    Minimum_Distance: ['Minimum distance', 999.99], Maximum_Distance: ['Maximum distance', 9999.99, 0.01],
    rides_limit: ['Ride limit', 1000000, 0, true], rides_over_limit_count: ['Over-limit/wallet threshold', 1000000, 0, true],
};
const RATE_COLUMNS = ['Rate_ID_Pk', 'Vehicle_Type', 'Currency', 'Is_Active', ...Object.keys(RATE_FIELDS)];
function versionOf(document) { return createHash('sha256').update(JSON.stringify(document)).digest('hex'); }
function normalizeSettings(value) {
    if (!value || Object.keys(value).some(key => !['services', 'policy', 'rates'].includes(key)) || !value.services || Object.keys(value.services).some(key => !CONFIG_KEYS.includes(key))) throw fail(400, 'Invalid settings document.');
    const services = {};
    for (const key of SERVICE_FLAGS) { if (typeof value.services[key] !== 'boolean') throw fail(400, 'Service switches must be true or false.'); services[key] = value.services[key]; }
    for (const key of ['dispatch_min_radius_km', 'dispatch_radius_km']) services[key] = decimal(value.services[key], 'Dispatch radius', 100, 0.01);
    if (services.dispatch_min_radius_km > services.dispatch_radius_km) throw fail(400, 'Initial dispatch radius cannot exceed maximum radius.');
    if (!Array.isArray(value.rates) || !value.rates.length || value.rates.length > 500) throw fail(400, 'Send between one and 500 registered vehicle rates.');
    const seen = new Set();
    const rates = value.rates.map(rate => {
        if (!rate || Object.keys(rate).some(key => !RATE_COLUMNS.includes(key))) throw fail(400, 'Unknown vehicle-rate field.');
        const id = decimal(rate.Rate_ID_Pk, 'Rate ID', Number.MAX_SAFE_INTEGER, 1, true);
        if (seen.has(id)) throw fail(400, 'Vehicle rates must be unique.'); seen.add(id);
        if (typeof rate.Vehicle_Type !== 'string' || !rate.Vehicle_Type.trim() || rate.Vehicle_Type.length > 50 || rate.Currency !== 'PKR' || typeof rate.Is_Active !== 'boolean') throw fail(400, 'Vehicle name/currency cannot be changed here, and active status must be true or false.');
        const result = { Rate_ID_Pk: id, Vehicle_Type: rate.Vehicle_Type, Currency: rate.Currency, Is_Active: rate.Is_Active };
        for (const [key, [label, max, min = 0, integer = false]] of Object.entries(RATE_FIELDS)) result[key] = decimal(rate[key], label, max, min, integer);
        if (result.Minimum_Distance > result.Maximum_Distance) throw fail(400, 'Minimum billable distance cannot exceed maximum trip distance.');
        return result;
    }).sort((a, b) => a.Rate_ID_Pk - b.Rate_ID_Pk);
    if (services.ride_service && !rates.some(rate => rate.Is_Active)) throw fail(400, 'Keep at least one vehicle rate active while ride service is enabled.');
    return { services, policy: validatePolicy(value.policy), rates };
}
async function readSettings(conn, lock = false) {
    const [services] = await conn.query(`SELECT ${CONFIG_KEYS.join(',')} FROM sysconfigsetup WHERE SCS_ID_Pk = 1${lock ? ' FOR UPDATE' : ''}`);
    if (!services.length) throw fail(404, 'System configuration row 1 is missing.');
    const { policy, editable: policyEditable } = await loadFarePolicy(conn, { lock, withStorage: true });
    const [rates] = await conn.query(`SELECT ${RATE_COLUMNS.join(',')} FROM vehicle_fare_rate ORDER BY Rate_ID_Pk${lock ? ' FOR UPDATE' : ''}`);
    const configuration = { services: Object.fromEntries(CONFIG_KEYS.map(key => [key, SERVICE_FLAGS.includes(key) ? Boolean(services[0][key]) : Number(services[0][key])])), policy,
        rates: rates.map(rate => Object.fromEntries(RATE_COLUMNS.map(key => [key, key === 'Is_Active' ? Boolean(rate[key]) : ['Currency', 'Vehicle_Type'].includes(key) ? rate[key] || 'PKR' : Number(rate[key] ?? 0)]))) };
    return { configuration, version: versionOf(configuration), capabilities: { policy_editable: policyEditable } };
}
async function requireSettingsActor(conn, actor) {
    if (employeeAccessEnabled()) { const access = await getAccess(conn, actor, { lock: true }); if (!access.functions.includes('settings')) throw fail(403, 'Settings access is required.'); }
    else { const [rows] = await conn.query("SELECT User_ID_Pk FROM users WHERE User_ID_Pk = ? AND LOWER(TRIM(Role)) = 'admin' AND COALESCE(AccountDeleted,0) = 0 LOCK IN SHARE MODE", [actor]); if (!rows.length) throw fail(401, 'An active admin account is required.'); }
}
function createAdminSettings(pool) {
    return {
        async get() { let conn; try { conn = await pool.getConnection(); await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); await conn.beginTransaction(); const result = await readSettings(conn); await conn.commit(); return result; } catch (error) { if (conn) await conn.rollback().catch(() => {}); throw error; } finally { conn?.release(); } },
        async update(actor, body) {
            if (!body || Object.keys(body).some(key => !['version', 'configuration'].includes(key)) || typeof body.version !== 'string' || !/^[a-f0-9]{64}$/.test(body.version)) throw fail(400, 'Reload configuration before saving.');
            const next = normalizeSettings(body.configuration); let conn;
            try {
                conn = await pool.getConnection(); await conn.beginTransaction(); await requireSettingsActor(conn, actor);
                const current = await readSettings(conn, true);
                if (body.version !== current.version) throw fail(409, 'Settings changed elsewhere. Reload the latest configuration and review your changes.');
                if (!current.capabilities.policy_editable && JSON.stringify(next.policy) !== JSON.stringify(current.configuration.policy)) throw fail(400, 'Custom peak/night times are not stored on this database. Vehicle fares and peak/night surcharge percentages can still be updated.');
                if (next.rates.length !== current.configuration.rates.length || next.rates.some((rate, i) => rate.Rate_ID_Pk !== current.configuration.rates[i].Rate_ID_Pk || rate.Vehicle_Type !== current.configuration.rates[i].Vehicle_Type || rate.Currency !== current.configuration.rates[i].Currency)) throw fail(400, 'Vehicle identities cannot be added, renamed, or removed by this update.');
                await conn.query(`UPDATE sysconfigsetup SET ${CONFIG_KEYS.map(key => `${key} = ?`).join(',')} WHERE SCS_ID_Pk = 1`, CONFIG_KEYS.map(key => next.services[key]));
                if (JSON.stringify(next.policy) !== JSON.stringify(current.configuration.policy)) await conn.query('UPDATE fare_policy SET policy_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [JSON.stringify(next.policy), actor]);
                const mutableFields = ['Is_Active', ...Object.keys(RATE_FIELDS)];
                for (const rate of next.rates) {
                    const before = current.configuration.rates.find(item => item.Rate_ID_Pk === rate.Rate_ID_Pk);
                    if (mutableFields.every(key => rate[key] === before[key])) continue;
                    await conn.query(`UPDATE vehicle_fare_rate SET ${mutableFields.map(key => `${key} = ?`).join(',')}, UpdatedAt = CURRENT_TIMESTAMP WHERE Rate_ID_Pk = ?`, [...mutableFields.map(key => rate[key]), rate.Rate_ID_Pk]);
                }
                let auditInDatabase = true;
                try {
                    await conn.query('INSERT INTO admin_setting_audit (created_by, before_json, after_json) VALUES (?, ?, ?)', [actor, JSON.stringify(current.configuration), JSON.stringify(next)]);
                } catch (error) {
                    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
                    auditInDatabase = false;
                }
                const saved = await readSettings(conn); await conn.commit();
                if (!auditInDatabase) console.info('Admin settings updated', { adminId: actor, auditStorage: 'server_log', before: current.configuration, after: saved.configuration });
                return saved;
            } catch (error) { if (conn) await conn.rollback().catch(() => {}); if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) throw fail(409, 'Another settings update is in progress. Reload and try again.'); throw error; } finally { conn?.release(); }
        },
        preview(body) {
            const configuration = normalizeSettings(body?.configuration);
            const rate = configuration.rates.find(item => item.Rate_ID_Pk === Number(body.rate_id));
            const distance = decimal(body.distance, 'Distance', 9999.99, 0.01), duration = decimal(body.duration, 'Duration', 100000), waiting = decimal(body.waiting_time, 'Waiting time', 100000);
            if (!rate || !rate.Is_Active || distance > rate.Maximum_Distance) throw fail(400, 'Choose an active vehicle within its maximum trip distance.');
            if (body.at && (typeof body.at !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.at))) throw fail(400, 'Preview time must include a timezone.');
            const at = body.at ? new Date(body.at) : new Date(), status = scheduleStatus(configuration.policy, at);
            return { ...calculateEstimatedFare(rate, distance, duration, status.isPeak, status.isNight, waiting, configuration.policy), is_peak_hour: status.isPeak, is_night: status.isNight, currency: 'PKR', at: at.toISOString() };
        },
    };
}
module.exports = { createAdminSettings, readSettings, normalizeSettings, versionOf, RATE_FIELDS, CONFIG_KEYS };
