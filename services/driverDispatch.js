const { cache } = require('./redisCache');
const { createHash } = require('node:crypto');
function positiveSetting(name, fallback, max) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

const SEARCH_STAGE_SECONDS = 10;
const SEARCH_STEP_KM = 1;
async function getSearchConfig(conn, { requireRideEnabled = false } = {}) {
    const rows = await cache.remember('search:config', 5, async () => {
        const [result] = await conn.query("SELECT dispatch_radius_km, dispatch_min_radius_km, ride_service FROM sysconfigsetup WHERE SCS_ID_Pk = 1 LIMIT 1");
        return result;
    });
    if (requireRideEnabled && rows[0]?.ride_service != null && Number(rows[0].ride_service) !== 1) throw Object.assign(new Error('Ride booking is temporarily unavailable.'), { status: 503 });
    const max = rows[0]?.dispatch_radius_km;
    const min = rows[0]?.dispatch_min_radius_km;
    if (!numeric(max) || !numeric(min) || Number(min) <= 0 || Number(max) < Number(min)) {
        throw new Error('Configure positive dispatch_min_radius_km <= dispatch_radius_km in sysconfigsetup (SCS_ID_Pk = 1).');
    }
    return { minRadiusKm: Number(min), maxRadiusKm: Number(max), stepKm: SEARCH_STEP_KM, stageSeconds: SEARCH_STAGE_SECONDS };
}
async function getDispatchRadiusKm(conn) {
    return (await getSearchConfig(conn)).maxRadiusKm;
}
function getSearchDurationSeconds(config) {
    const spanCents = Math.round(config.maxRadiusKm * 100) - Math.round(config.minRadiusKm * 100);
    return (Math.ceil(spanCents / Math.round(config.stepKm * 100)) + 1) * config.stageSeconds;
}
function getSearchState(ride, config) {
    const age = Math.max(0, Number(ride.Search_Age_Seconds));
    if (!Number.isFinite(age)) throw new Error('Ride search requires database search age.');
    const duration = getSearchDurationSeconds(config);
    const stages = duration / config.stageSeconds;
    const stage = Math.min(stages - 1, Math.floor(age / config.stageSeconds));
    return {
        radius_km: Math.min(Math.round(config.maxRadiusKm * 100), Math.round(config.minRadiusKm * 100) + stage * Math.round(config.stepKm * 100)) / 100,
        min_radius_km: config.minRadiusKm, max_radius_km: config.maxRadiusKm,
        stage, remaining_seconds: Math.max(0, duration - age),
        duration_seconds: duration, exhausted: age >= duration,
    };
}
const presenceTtlMs = positiveSetting('DRIVER_PRESENCE_TTL_SECONDS', 45, 300) * 1000;
const category = value => String(value || '').trim().toLowerCase();
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
function validCoordinates(lat, lng) {
    return numeric(lat) && numeric(lng) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
}
function distanceKm(lat1, lng1, lat2, lng2) {
    const rad = n => Number(n) * Math.PI / 180;
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
function freshPresence(presence, now = Date.now()) {
    return !!presence && validCoordinates(presence.lat, presence.lng) &&
        Number.isFinite(presence.updatedAt) && now >= presence.updatedAt && now - presence.updatedAt <= presenceTtlMs;
}
function matchesRide(presence, ride, radiusKm, now = Date.now()) {
    return Number.isFinite(radiusKm) && radiusKm > 0 && freshPresence(presence, now) && category(presence.vehicle_type) === category(ride.Vehicle_Type) &&
        String(presence.userId) !== String(ride.User_ID_Fk) &&
        validCoordinates(ride.Pickup_Lat, ride.Pickup_Lng) &&
        distanceKm(presence.lat, presence.lng, ride.Pickup_Lat, ride.Pickup_Lng) <= radiusKm;
}

async function getDriverPresence(io, driverId, userId) {
    const sockets = await io.in(`user:${userId}`).fetchSockets();
    return sockets.map(socket => socket.data?.driverPresence)
        .filter(p => freshPresence(p) && String(p.driverId) === String(driverId) && String(p.userId) === String(userId))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

async function getEligibleDriverIds(conn, ids, vehicleType) {
    const signature = createHash('sha256').update(JSON.stringify([category(vehicleType), [...ids].map(String).sort()])).digest('hex');
    return cache.remember(`eligibility:${signature}`, 5, async () => {
        const [drivers] = await conn.query(
            `SELECT d.id FROM drivers d
         WHERE d.id IN (${ids.map(() => '?').join(',')})
           AND LOWER(TRIM(d.status)) = 'active'
           AND LOWER(TRIM(d.vehicle_type)) = ? AND d.Is_Available = 1
           AND (d.overdue_since IS NULL OR d.overdue_since > DATE_SUB(NOW(), INTERVAL 8 HOUR))
           AND NOT EXISTS (SELECT 1 FROM ride_history active
               WHERE active.Driver_ID_Fk = d.id AND active.Ride_Status IN ('Accepted','Arrived','Started','Ongoing'))`,
            [...ids, category(vehicleType)]
        );
        return drivers.map(d => String(d.id));
    });
}

async function nearbyDriverLocations(io, conn, lat, lng, radiusKm, vehicleType) {
    let locations = await cache.nearby(lat, lng, radiusKm, category(vehicleType));
    if (locations === null) {
        const sockets = await io.in(`vehicle:${category(vehicleType)}`).fetchSockets();
        locations = sockets.map(s => ({ ...s.data?.driverPresence, sessionId: s.id }));
    }
    const candidates = locations.filter(p => freshPresence(p) && category(p.vehicle_type) === category(vehicleType) &&
        distanceKm(lat, lng, p.lat, p.lng) <= radiusKm);
    if (!candidates.length) return [];
    const eligible = new Set(await getEligibleDriverIds(conn, [...new Set(candidates.map(p => p.driverId))], vehicleType));
    const unique = new Map();
    for (const p of candidates) {
        if (eligible.has(String(p.driverId)) && (!unique.has(String(p.driverId)) || unique.get(String(p.driverId)).updatedAt < p.updatedAt)) unique.set(String(p.driverId), p);
    }
    return [...unique.values()].sort((a, b) => distanceKm(lat, lng, a.lat, a.lng) - distanceKm(lat, lng, b.lat, b.lng)).slice(0, 30);
}

async function clearDriverPresence(io, driverId, userId) {
    const sockets = await io.in(`user:${userId}`).fetchSockets();
    for (const socket of sockets) {
        const presence = socket.data?.driverPresence;
        if (String(presence?.driverId) !== String(driverId)) continue;
        socket.data.driverPresence = null;
        await cache.removePresence(socket.id, presence.vehicle_type);
    }
}

// Connection presence is authoritative; DB flags alone cannot prove a live driver.
// fetchSockets also works with a shared Socket.IO adapter when added later.
async function dispatchRide(io, conn, ride, event, payload, config) {
    if (ride.Ride_Status !== 'Requested' || ride.Driver_ID_Fk != null) return 0;
    const search = getSearchState(ride, config || await getSearchConfig(conn));
    if (search.exhausted) return 0;
    const radiusKm = search.radius_km;
    const sockets = await io.in(`vehicle:${category(ride.Vehicle_Type)}`).fetchSockets();
    const candidates = sockets.filter(s => matchesRide(s.data?.driverPresence, ride, radiusKm));
    if (!candidates.length) return 0;
    const ids = [...new Set(candidates.map(s => s.data.driverPresence.driverId))];
    const eligibleIds = await getEligibleDriverIds(conn, ids, ride.Vehicle_Type);
    const eligible = new Set(eligibleIds);
    const targets = candidates.filter(s => eligible.has(String(s.data.driverPresence.driverId)) && matchesRide(s.data.driverPresence, ride, radiusKm));
    if (targets.length) io.to(targets.map(s => s.id)).emit(event, payload);
    return targets.length;
}

module.exports = { getSearchConfig, getSearchState, getSearchDurationSeconds, SEARCH_STAGE_SECONDS, SEARCH_STEP_KM, getDispatchRadiusKm, presenceTtlMs, category, validCoordinates, distanceKm, freshPresence, matchesRide, getDriverPresence, dispatchRide, nearbyDriverLocations, clearDriverPresence };
