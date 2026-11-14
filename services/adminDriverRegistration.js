const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { getAccess, fail } = require('./employeeAccess');
const { validateMember } = require('./adminFranchiseMembers');
const { createCityToCityDrivers, validateApplication, DOCUMENT_TYPES } = require('./cityToCityDrivers');
const { USER_PHONE_SQL, phoneArgs, acquirePhoneLock, releasePhoneLock } = require('./appUserIdentity');
const { storeDocument } = require('./adminDriverDocuments');
const { formatDriverCode } = require('../utils/driverHelper');
const { formatCityToCityDriverCode } = require('./cityToCityDriverCode');
const screenOf = kind => kind === 'normal' ? 'drivers' : 'city_to_city_drivers';
function validateRequest(kind, body) {
    if (!['normal', 'city_to_city'].includes(kind) || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['profile','application','idempotency_key'].includes(k))) throw fail(400, 'Invalid driver registration.');
    // The shared member validator whitelists personal fields and normalizes phones.
    const data = validateMember({ kind: kind === 'normal' ? 'driver' : 'rider', profile: body.profile, idempotency_key: body.idempotency_key });
    if (kind === 'normal' && body.application) throw fail(400, 'Unexpected city-to-city application.');
    const application = kind === 'city_to_city' ? validateApplication(body.application) : null;
    if (application && (application.name !== data.full_name || application.address !== data.address)) throw fail(400, 'Personal and application details must match.');
    return { data, application };
}
function createAdminDriverRegistration(pool, { saveDocument = storeDocument } = {}) {
    const intercity = createCityToCityDrivers(pool);
    async function authorize(conn, actor, kind, lock = false) {
        const access = await getAccess(conn, actor, { lock });
        if (!access.functions.includes(screenOf(kind))) throw fail(403, 'Driver registration access is required.');
    }
    return {
        async options(actor, kind) {
            const conn = await pool.getConnection();
            try {
                await authorize(conn, actor, kind);
                if (kind === 'normal') {
                    const [vehicles] = await conn.query('SELECT Vehicle_Type AS name FROM vehicle_fare_rate WHERE Is_Active=1 ORDER BY Vehicle_Type');
                    return { vehicles };
                }
                const [cities] = await conn.query('SELECT ID_PK AS id,City_Name AS name FROM city ORDER BY City_Name');
                const [services] = await conn.query('SELECT code,name FROM city_to_city_services WHERE is_active=1 ORDER BY sort_order');
                return { cities, services, vehicles: ['Car','Ride Mini','Ride AC','Ride Plus','Sedan','SUV','MPV','Van'].map(name => ({ name })) };
            } finally { conn.release(); }
        },
        async create(actor, kind, body, files = {}) {
            const { data } = validateRequest(kind, body);
            const fingerprint = crypto.createHash('sha256').update(JSON.stringify([kind, data, body.application || null])).digest('hex');
            const conn = await pool.getConnection();
            let lock, started = false, committing = false;
            const stored = [];
            try {
                lock = await acquirePhoneLock(conn, data.phone);
                await conn.beginTransaction(); started = true;
                await authorize(conn, actor, kind, true);
                const [requests] = await conn.query('SELECT * FROM admin_driver_registration_requests WHERE request_key=? FOR UPDATE', [body.idempotency_key]);
                if (requests.length) {
                    const old = requests[0];
                    if (Number(old.actor_id) !== Number(actor) || old.fingerprint !== fingerprint) throw fail(409, 'This request key was already used with different details.');
                    await conn.commit(); started = false;
                    return { id: old.driver_id, user_id: old.user_id, kind, status: 'pending', replayed: true };
                }
                const [users] = await conn.query(`SELECT User_ID_Pk,Role,AccountDeleted,Franchiser_ID_FK FROM users WHERE ${USER_PHONE_SQL} LIMIT 2 FOR UPDATE`, phoneArgs(data.phone));
                if (users.length > 1) throw fail(409, 'Multiple accounts use this phone. Review their user links first.');
                const owner = users[0];
                if (owner && (Number(owner.AccountDeleted) || !['rider','user','customer','driver',''].includes(String(owner.Role || '').trim().toLowerCase()))) throw fail(409, 'This phone does not belong to an active personal account.');
                if (owner?.Franchiser_ID_FK) throw fail(409, 'This account is connected to a franchise. Use the franchise workflow.');
                if (data.email) {
                    const [emails] = await conn.query('SELECT User_ID_Pk FROM users WHERE Email=? AND User_ID_Pk<>? LIMIT 1', [data.email, owner?.User_ID_Pk || 0]);
                    if (emails.length) throw fail(409, 'This email already belongs to another account.');
                }
                const table = kind === 'normal' ? 'drivers' : 'city_to_city_drivers';
                const ownerColumn = kind === 'normal' ? 'User_ID_FK' : 'user_id';
                const [duplicates] = await conn.query(kind === 'normal'
                    ? `SELECT id FROM drivers WHERE User_ID_FK=? OR REPLACE(REPLACE(REPLACE(phone,'-',''),' ',''),'+','') IN (?,?) LIMIT 1 FOR UPDATE`
                    : `SELECT id FROM ${table} WHERE ${ownerColumn}=? LIMIT 1 FOR UPDATE`,
                    kind === 'normal' ? [owner?.User_ID_Pk || 0, ...phoneArgs(data.phone)] : [owner?.User_ID_Pk || 0]);
                if (duplicates.length) throw fail(409, 'This account already has this type of driver profile. Open the existing driver.');
                if (kind === 'normal') {
                    const [types] = await conn.query('SELECT Vehicle_Type FROM vehicle_fare_rate WHERE Is_Active=1 AND Vehicle_Type=? LIMIT 1', [data.vehicle_type]);
                    if (!types.length) throw fail(400, 'Choose an active vehicle type.');
                }
                let userId = owner?.User_ID_Pk;
                if (!userId) {
                    const [user] = await conn.query("INSERT INTO users (User_Name,Mobile,Email,Role,Unique_ID,Franchiser_ID_FK,City,Address,Cnic) VALUES (?,?,?,'rider',?,NULL,?,?,?)", [data.full_name,data.phone,data.email || null,crypto.randomBytes(16).toString('hex'),data.city,data.address || null,data.cnic || body.application?.Cnic || null]);
                    userId = user.insertId;
                }
                const paths = {}, applicationFiles = {};
                for (const [field, type] of Object.entries(DOCUMENT_TYPES)) {
                    if (!files[field]?.[0]) continue;
                    const saved = await saveDocument(files[field][0], type); stored.push(saved);
                    paths[type] = saved.storedPath;
                    applicationFiles[field] = [{ storedPath: saved.storedPath }];
                }
                let driverId;
                if (kind === 'normal') {
                    const fields = { ...data, photo_path: paths.photo || null, cnic_front_path: paths.cnic_front || null, cnic_back_path: paths.cnic_back || null, license_path: paths.license || null, vehicle_doc_path: paths.vehicle_registration || null };
                    const [driver] = await conn.query(`INSERT INTO drivers (User_ID_FK,Franchiser_ID_FK,status,join_date,${Object.keys(fields).join(',')}) VALUES (?,NULL,'pending',CURDATE(),${Object.keys(fields).map(() => '?').join(',')})`, [userId,...Object.values(fields)]);
                    driverId = driver.insertId;
                    await conn.query('UPDATE drivers SET driver_code=? WHERE id=?', [formatDriverCode(driverId),driverId]);
                } else {
                    const result = await intercity.registerOnConnection(conn,userId,body.application,applicationFiles);
                    driverId = result.profile.id;
                }
                await conn.query('INSERT INTO admin_driver_registration_requests (request_key,actor_id,fingerprint,driver_kind,driver_id,user_id) VALUES (?,?,?,?,?,?)', [body.idempotency_key,actor,fingerprint,kind,driverId,userId]);
                committing = true;
                await conn.commit(); started = false;
                return { id: driverId, user_id: userId, kind, driver_code: kind === 'normal' ? formatDriverCode(driverId) : formatCityToCityDriverCode(driverId), status: 'pending' };
            } catch (error) {
                if (started) await conn.rollback().catch(() => {});
                if (!committing) await Promise.all(stored.map(file => fs.unlink(file.filePath).catch(() => {})));
                if (error.code === 'ER_DUP_ENTRY') throw fail(409, 'A matching account or registration already exists. Review the existing record.');
                throw error;
            } finally { await releasePhoneLock(conn, lock); conn.release(); }
        },
    };
}
module.exports = { createAdminDriverRegistration, validateRequest };
