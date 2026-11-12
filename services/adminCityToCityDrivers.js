const { createCityToCityDrivers, validateApplication, fail, validSavedCar } = require('./cityToCityDrivers');
const { getAccess } = require('./employeeAccess');
function createAdminCityToCityDrivers(pool) {
    const profiles = createCityToCityDrivers(pool);
    function id(value) { if (!/^[1-9]\d*$/.test(String(value)) || Number(value) > 2147483647) throw fail(400, 'Invalid driver ID.'); return Number(value); }
    async function actor(conn, userId) {
        const access = await getAccess(conn, userId, { lock: true }); if (!access.functions.includes('city_to_city_drivers')) throw fail(403, 'Driver management access is required.');
    }
    return {
        async list(query = {}) {
            const page = Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1));
            const size = 30;
            const status = query.status || '';
            if (status && !['draft','pending','approved','rejected','suspended'].includes(status)) throw fail(400, 'Invalid application status.');
            const where = status ? 'WHERE d.application_status=?' : '';
            const params = status ? [status] : [];
            const [rows] = await pool.query(`SELECT d.id,d.driver_code,d.full_name,d.application_status,d.created_at,d.enrollment_source,c.City_Name AS city,u.Mobile AS phone FROM city_to_city_drivers d JOIN users u ON u.User_ID_Pk=d.user_id LEFT JOIN city c ON c.ID_PK=d.home_city_id ${where} ORDER BY d.id DESC LIMIT ? OFFSET ?`, [...params,size,(page-1)*size]);
            const [counts] = await pool.query(`SELECT COUNT(*) AS total FROM city_to_city_drivers d ${where}`, params);
            return { rows, page, page_size: size, total: Number(counts[0].total) };
        },
        async detail(driverId) { const [rows] = await pool.query('SELECT user_id FROM city_to_city_drivers WHERE id=?', [id(driverId)]); if (!rows.length) throw fail(404, 'Driver not found.'); const result=await profiles.account(rows[0].user_id); return {...result.profile,cities:(await profiles.options(rows[0].user_id,{withSource:false})).cities}; },
        async completeImported(driverId, actorId, body) {
            driverId=id(driverId);
            const conn=await pool.getConnection();
            try {
                await conn.beginTransaction(); await actor(conn,actorId);
                const [profiles]=await conn.query('SELECT * FROM city_to_city_drivers WHERE id=? FOR UPDATE',[driverId]);
                const profile=profiles[0];
                if(!profile || profile.enrollment_source!=='city_driver') throw fail(404,'Imported application not found.');
                if(!['pending','rejected','draft'].includes(profile.application_status)) throw fail(409,'Only an application under review can be completed.');
                const data=validateApplication({...body,EasyPaisa:profile.easypaisa,JazzCash:profile.jazzcash});
                const [cities]=await conn.query('SELECT ID_PK FROM city WHERE ID_PK=?',[data.cityId]);
                if(!cities.length) throw fail(400,'Select a valid city.');
                const [services]=await conn.query(`SELECT id,code FROM city_to_city_services WHERE is_active=1 AND code IN (${data.services.map(()=>'?').join(',')})`,data.services);
                if(services.length!==data.services.length) throw fail(400,'Select active services.');
                const [vehicles]=await conn.query('SELECT id FROM city_to_city_vehicles WHERE city_to_city_driver_id=? AND is_active=1 FOR UPDATE',[driverId]);
                const vehicleValues=[data.vehicleType,data.make,data.model,data.year,data.plate,data.color,data.seats,data.weight];
                let vehicleId=vehicles[0]?.id;
                if(vehicleId) await conn.query("UPDATE city_to_city_vehicles SET vehicle_type=?,make=COALESCE(?,make),model=?,manufacture_year=COALESCE(?,manufacture_year),registration_number=?,color=?,passenger_capacity=?,max_parcel_weight_kg=?,approval_status='pending' WHERE id=?",[...vehicleValues,vehicleId]);
                else { const [vehicle]=await conn.query('INSERT INTO city_to_city_vehicles (city_to_city_driver_id,vehicle_type,make,model,manufacture_year,registration_number,color,passenger_capacity,max_parcel_weight_kg) VALUES (?,?,?,?,?,?,?,?,?)',[driverId,...vehicleValues]); vehicleId=vehicle.insertId; }
                const [registration]=await conn.query("SELECT id FROM city_to_city_driver_documents WHERE city_to_city_driver_id=? AND vehicle_id=? AND document_type='vehicle_registration' LIMIT 1",[driverId,vehicleId]);
                let originalVehicle; try { originalVehicle=JSON.parse(profile.source_snapshot || '{}'); } catch {originalVehicle={};}
                if(!registration.length && validSavedCar(originalVehicle)) await conn.query("UPDATE city_to_city_driver_documents SET vehicle_id=? WHERE city_to_city_driver_id=? AND document_type='vehicle_registration' AND vehicle_id IS NULL",[vehicleId,driverId]);
                await conn.query("UPDATE city_to_city_driver_services SET approval_status='suspended',is_enabled=0 WHERE city_to_city_driver_id=?",[driverId]);
                for(const service of services) await conn.query("INSERT INTO city_to_city_driver_services (city_to_city_driver_id,service_id,service_type,approval_status,is_enabled) VALUES (?,?,?,'pending',0) ON DUPLICATE KEY UPDATE approval_status='pending',is_enabled=0",[driverId,service.id,service.code]);
                await conn.query("UPDATE city_to_city_drivers SET home_city_id=?,full_name=?,father_name=?,cnic=?,dob=?,address=?,application_status='pending',rejection_reason=NULL,is_online=0 WHERE id=?",[data.cityId,data.name,data.father,data.cnic,data.dob,data.address,driverId]);
                await conn.commit(); return {id:driverId,application_status:'pending'};
            } catch(error) { await conn.rollback().catch(()=>{}); throw error; } finally { conn.release(); }
        },
        async document(driverId, documentId) {
            const [rows] = await pool.query('SELECT file_key FROM city_to_city_driver_documents WHERE id=? AND city_to_city_driver_id=?', [id(documentId),id(driverId)]);
            if (!rows.length) throw fail(404, 'Document not found.'); return rows[0].file_key;
        },
        async review(driverId, actorId, body) {
            driverId = id(driverId);
            if (!body || !['approved','rejected','suspended'].includes(body.status) || !['draft','pending','approved','rejected','suspended'].includes(body.expected_status)) throw fail(400, 'Choose a valid review status and reload the current application.');
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            if ((body.status !== 'approved' && !reason) || reason.length > 1000) throw fail(400, 'Enter a reason of up to 1,000 characters.');
            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction(); await actor(conn, actorId);
                const [drivers] = await conn.query('SELECT id,application_status FROM city_to_city_drivers WHERE id=? FOR UPDATE', [driverId]);
                if (!drivers.length) throw fail(404, 'Driver not found.');
                if (drivers[0].application_status !== body.expected_status) throw fail(409, 'This application changed. Reload before reviewing.');
                const [trips] = await conn.query("SELECT id FROM city_to_city_trips WHERE city_to_city_driver_id=? AND status IN ('boarding','in_progress') LIMIT 1 FOR UPDATE", [driverId]);
                if (trips.length) throw fail(409, 'This driver has an active trip. Resolve the trip before changing approval.');
                if (body.status === 'approved') {
                    if (!['pending','suspended'].includes(drivers[0].application_status)) throw fail(409, 'Only pending or suspended profiles can be approved.');
                    const [vehicles] = await conn.query('SELECT id FROM city_to_city_vehicles WHERE city_to_city_driver_id=? AND is_active=1 FOR UPDATE', [driverId]);
                    if (!vehicles.length) throw fail(400, 'An active vehicle is required before approval.');
                    const [home]=await conn.query('SELECT home_city_id FROM city_to_city_drivers WHERE id=?',[driverId]);
                    if(!home[0]?.home_city_id) throw fail(400,'Complete the home city before approval.');
                    const [documents] = await conn.query('SELECT id,document_type,vehicle_id,expires_at FROM city_to_city_driver_documents WHERE city_to_city_driver_id=? ORDER BY id DESC FOR UPDATE', [driverId]);
                    const latest = new Map();
                    for (const doc of documents) { const key = `${doc.document_type}:${doc.vehicle_id || 0}`; if (!latest.has(key)) latest.set(key, doc); }
                    const needed = ['photo','cnic_front','cnic_back','license'].map(type => latest.get(`${type}:0`));
                    for (const vehicle of vehicles) needed.push(latest.get(`vehicle_registration:${vehicle.id}`));
                    if (needed.some(doc => !doc || (doc.expires_at && new Date(doc.expires_at) <= new Date()))) throw fail(400, 'Upload all five required, unexpired identity and vehicle documents before approval.');
                    const [services] = await conn.query("SELECT ds.id FROM city_to_city_driver_services ds JOIN city_to_city_services s ON s.id=ds.service_id WHERE ds.city_to_city_driver_id=? AND ds.approval_status IN ('pending','approved') AND s.is_active=1 FOR UPDATE", [driverId]);
                    if (!services.length) throw fail(400, 'At least one selected active service is required.');
                    await conn.query(`UPDATE city_to_city_driver_documents SET review_status='approved',reviewed_by=?,reviewed_at=NOW(),rejection_reason=NULL WHERE id IN (${needed.map(() => '?').join(',')})`, [actorId,...needed.map(doc => doc.id)]);
                    await conn.query("UPDATE city_to_city_vehicles SET approval_status='approved' WHERE city_to_city_driver_id=? AND is_active=1", [driverId]);
                    await conn.query(`UPDATE city_to_city_driver_services SET approval_status='approved',is_enabled=1 WHERE id IN (${services.map(() => '?').join(',')})`, services.map(service => service.id));
                } else {
                    await conn.query('UPDATE city_to_city_driver_services SET is_enabled=0 WHERE city_to_city_driver_id=?', [driverId]);
                }
                await conn.query("UPDATE city_to_city_drivers SET application_status=?,rejection_reason=?,approved_by=?,approved_at=IF(?='approved',NOW(),NULL),is_online=0 WHERE id=?", [body.status,reason||null,actorId,body.status,driverId]);
                await conn.commit();
                return { id: driverId, application_status: body.status };
            } catch (error) { await conn.rollback().catch(() => {}); throw error; }
            finally { conn.release(); }
        },
    };
}
module.exports = { createAdminCityToCityDrivers };
