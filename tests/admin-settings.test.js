const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_POLICY, validatePolicy, scheduleStatus, calculateEstimatedFare, loadFarePolicy } = require('../services/farePolicy');
const { createAdminSettings, normalizeSettings, versionOf, CONFIG_KEYS, RATE_FIELDS } = require('../services/adminSettings');
const rate = { Rate_ID_Pk: 1, Vehicle_Type: 'Mini', Currency: 'PKR', Is_Active: true, Base_Fare: 100, Per_Km_Rate: 20, Per_Minute_Rate: 5, Fee_Percentage: 10, Night_Charge_Percent: 20, Peak_Hours_Percent: 25, Minimum_Distance: 1, Maximum_Distance: 50, rides_limit: 0, rides_over_limit_count: 300 };
function document() { return normalizeSettings({ services: { ride_service: true, courier_service: false, food_delivery_service: false, grocery_service: false, fare_increaser: true, dispatch_min_radius_km: 1, dispatch_radius_km: 5 }, policy: structuredClone(DEFAULT_POLICY), rates: [{ ...rate }] }); }
test('default pricing preserves included first km, time/waiting, additive surcharges, fee and upward rounding', () => {
    const calculation = calculateEstimatedFare(rate, 5, 10, true, false, 0);
    assert.equal(calculation.base_fare, 100); assert.equal(calculation.distance_fare, 80); assert.equal(calculation.time_fare, 50);
    assert.equal(calculation.peak_hour_surcharge, 57.5); assert.equal(calculation.organization_fee, 28.75); assert.equal(calculation.total_fare, 320);
    const minimum = calculateEstimatedFare({ ...rate, Minimum_Distance: 3 }, 0.5, 0, false, false, 2);
    assert.equal(minimum.distance_fare, 40); assert.equal(minimum.waiting_charges, 10);
    assert.equal(calculateEstimatedFare({ ...rate, Base_Fare: 10.01, Fee_Percentage: 0 }, 1, 0, false, false, 0).total_fare, 20);
});
test('peak schedule uses Pakistan time, exclusive boundaries, weekdays and overnight ownership', () => {
    assert.equal(scheduleStatus(DEFAULT_POLICY, new Date('2026-11-09T03:00:00Z')).isPeak, true);
    assert.equal(scheduleStatus(DEFAULT_POLICY, new Date('2026-11-09T06:00:00Z')).isPeak, false);
    const policy = validatePolicy({ ...structuredClone(DEFAULT_POLICY), peak_windows: [{ start: '22:00', end: '02:00', days: [5] }] });
    assert.equal(scheduleStatus(policy, new Date('2026-11-13T18:00:00Z')).isPeak, true); // Friday 23:00 PKT
    assert.equal(scheduleStatus(policy, new Date('2026-11-13T20:00:00Z')).isPeak, true); // Saturday 01:00
    assert.equal(scheduleStatus(policy, new Date('2026-11-14T18:00:00Z')).isPeak, false);
    assert.equal(scheduleStatus({ ...policy, peak_enabled: false }, new Date('2026-11-13T18:00:00Z')).isPeak, false);
});
test('validation rejects unsafe or inconsistent settings before acquiring a connection', async () => {
    const service = createAdminSettings({ getConnection() { throw new Error('must not connect'); } });
    for (const mutate of [d => d.services.dispatch_min_radius_km = 10, d => d.policy.round_to = 0, d => d.policy.peak_windows[0].days = [1, 1], d => d.policy.night_start = '24:00', d => d.rates[0].Fee_Percentage = 101, d => d.rates[0].Is_Active = false, d => d.rates[0].Base_Fare = '1 OR 1=1', d => d.rates[0].Night_Charge_Percent = 1.2, d => d.services.password = 'injected']) {
        const next = document(); mutate(next); await assert.rejects(service.update(7, { version: 'a'.repeat(64), configuration: next }), { status: 400 });
    }
});
function fixture({ failAudit = false, policyMissing = false, auditMissing = false } = {}) {
    const state = { configuration: document(), commits: 0, rollbacks: 0, released: 0, updates: 0, audits: [] }; let pending;
    const conn = {
        async beginTransaction() { pending = structuredClone(state.configuration); },
        async commit() { state.configuration = pending; state.commits++; }, async rollback() { pending = null; state.rollbacks++; }, release() { state.released++; },
        async query(sql, args) {
            const current = pending || state.configuration;
            if (sql.startsWith('SET TRANSACTION')) return [[]];
            if (sql.includes('FROM users')) return [[{ User_ID_Pk: 7 }]];
            if (sql.startsWith('SELECT') && sql.includes('FROM sysconfigsetup')) return [[current.services]];
            if (sql.startsWith('SELECT') && sql.includes('FROM fare_policy')) { if (policyMissing) throw Object.assign(new Error('missing optional policy'), { code: 'ER_NO_SUCH_TABLE' }); return [[{ policy_json: JSON.stringify(current.policy) }]]; }
            if (sql.startsWith('SELECT') && sql.includes('FROM vehicle_fare_rate')) return [current.rates];
            if (sql.startsWith('UPDATE sysconfigsetup')) { CONFIG_KEYS.forEach((key, i) => pending.services[key] = args[i]); state.updates++; return [{}]; }
            if (sql.startsWith('UPDATE fare_policy')) { pending.policy = JSON.parse(args[0]); return [{}]; }
            if (sql.startsWith('UPDATE vehicle_fare_rate')) { const keys = ['Is_Active', ...Object.keys(RATE_FIELDS)]; const target = pending.rates.find(item => item.Rate_ID_Pk === args.at(-1)); keys.forEach((key, i) => target[key] = args[i]); return [{}]; }
            if (sql.startsWith('INSERT INTO admin_setting_audit')) { if (auditMissing) throw Object.assign(new Error('missing optional audit'), { code: 'ER_NO_SUCH_TABLE' }); if (failAudit) throw new Error('audit failed'); state.audits.push(args); return [{}]; }
            throw new Error(`Unexpected query: ${sql}`);
        },
    };
    return { state, conn, service: createAdminSettings({ getConnection: async () => conn }) };
}
test('settings update commits rates, schedules and switches together with authenticated actor audit', async () => {
    const f = fixture(); const initial = await f.service.get(); const next = structuredClone(initial.configuration);
    next.rates[0].Base_Fare = 150; next.services.courier_service = true; next.policy.peak_windows[0].start = '07:30';
    const result = await f.service.update(7, { version: initial.version, configuration: next });
    assert.equal(result.configuration.rates[0].Base_Fare, 150); assert.equal(f.state.configuration.services.courier_service, true);
    assert.notEqual(result.version, initial.version); assert.equal(f.state.audits[0][0], 7); assert.equal(JSON.parse(f.state.audits[0][1]).rates[0].Base_Fare, 100);
    assert.equal(f.state.rollbacks, 0); assert.equal(f.state.released, 2);
});
test('a failed audit rolls back every setting; stale versions cannot overwrite another admin', async () => {
    const failed = fixture({ failAudit: true }), before = document(), next = document(); next.rates[0].Base_Fare = 999;
    await assert.rejects(failed.service.update(7, { version: versionOf(before), configuration: next })); assert.deepEqual(failed.state.configuration, before); assert.equal(failed.state.rollbacks, 1);
    const f = fixture(); f.state.configuration.rates[0].Base_Fare = 200;
    await assert.rejects(f.service.update(7, { version: versionOf(before), configuration: next }), { status: 409 }); assert.equal(f.state.updates, 0);
});
test('vehicle identities cannot be renamed and draft fare preview performs no writes', async () => {
    const f = fixture(); const next = document(); next.rates[0].Vehicle_Type = 'Renamed';
    await assert.rejects(f.service.update(7, { version: versionOf(document()), configuration: next }), { status: 400 });
    const preview = f.service.preview({ configuration: document(), rate_id: 1, distance: 5, duration: 10, waiting_time: 0, at: '2026-11-09T09:00:00+05:00' });
    assert.equal(preview.total_fare, 320); assert.equal(preview.is_peak_hour, true); assert.equal(f.state.updates, 0);
});
test('public quotes fall back only when the optional policy table is absent', async () => {
    const missing = { query: async () => { throw Object.assign(new Error(), { code: 'ER_NO_SUCH_TABLE' }); } };
    assert.deepEqual(await loadFarePolicy(missing), DEFAULT_POLICY);
    await assert.rejects(loadFarePolicy(missing, { strict: true }), { status: 503 });
    await assert.rejects(loadFarePolicy({ query: async () => { throw new Error('connection failure'); } }));
});
test('public fare endpoint ignores client peak/night overrides and supports GET query parameters', async () => {
    const conn = { release() {}, async query(sql) {
        if (sql.includes('FROM sysconfigsetup')) return [[{ ride_service: 1 }]];
        if (sql.includes('FROM fare_policy')) return [[{ policy_json: JSON.stringify(DEFAULT_POLICY) }]];
        if (sql.includes('FROM vehicle_fare_rate')) return [[rate]];
        throw new Error('unexpected SQL');
    } };
    class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-09T04:00:00Z'])); } }
    const context = { module: { exports: {} }, Date: FixedDate, console, require: id => id === '../db/Connect_Db' ? { getConnection: async () => conn } : require(id) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller/farecalculationController.js'), 'utf8'), context);
    for (const method of ['GET', 'POST']) {
        const data = { distance: 5, duration: 10, is_peak_hour: false, is_night: true }; const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
        await context.module.exports.calculateFare({ method, body: method === 'POST' ? data : {}, query: data }, res);
        assert.equal(res.body.data.primary_calculation.is_peak_hour, true); assert.equal(res.body.data.primary_calculation.is_night_ride, false); assert.equal(res.body.data.primary_calculation.total_fare.amount, 320);
    }
});


test('existing vehicle_fare_rate prices and surcharge percentages remain editable without optional settings tables', async t => {
    const logs = []; t.mock.method(console, 'info', (...values) => logs.push(values));
    const f = fixture({ policyMissing: true, auditMissing: true });
    const loaded = await f.service.get();
    assert.equal(loaded.capabilities.policy_editable, false);
    assert.equal(loaded.configuration.rates[0].Base_Fare, 100);
    const next = structuredClone(loaded.configuration);
    next.rates[0].Base_Fare = 140; next.rates[0].Peak_Hours_Percent = 30;
    const saved = await f.service.update(7, { version: loaded.version, configuration: next });
    assert.equal(saved.configuration.rates[0].Base_Fare, 140);
    assert.equal(saved.configuration.rates[0].Peak_Hours_Percent, 30);
    assert.equal(saved.capabilities.policy_editable, false);
    assert.equal(f.state.rollbacks, 0);
    assert.equal(logs[0][1].adminId, 7); assert.equal(logs[0][1].auditStorage, 'server_log');
});
test('unsupported custom time changes are rejected explicitly without blocking ordinary rate edits', async () => {
    const f = fixture({ policyMissing: true }); const loaded = await f.service.get();
    const next = structuredClone(loaded.configuration); next.policy.peak_windows[0].start = '07:30'; next.rates[0].Base_Fare = 140;
    await assert.rejects(f.service.update(7, { version: loaded.version, configuration: next }), error => error.status === 400 && /surcharge percentages can still be updated/.test(error.message));
    assert.equal(f.state.updates, 0); assert.equal(f.state.configuration.rates[0].Base_Fare, 100);
});
