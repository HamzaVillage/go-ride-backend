const { randomUUID } = require('node:crypto');
const {formatCityToCityDriverCode}=require('./cityToCityDriverCode');
const fail = (status, message) => Object.assign(new Error(message), { status });
const VEHICLE_TYPES = ['Car', 'Ride Mini', 'Ride AC', 'Ride Plus', 'Sedan', 'SUV', 'MPV', 'Van'];
const DOCUMENT_TYPES = { Photo: 'photo', CNIC_Front: 'cnic_front', CNIC_Back: 'cnic_back', License: 'license', Vehicle_Running_Page: 'vehicle_registration' };
const ACTIVE_RIDES = "('Requested','Accepted','Arrived','Started','Ongoing')";
function text(value, label, max, required = true) {
    if (value == null && !required) return null;
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw fail(400, `Enter a valid ${label}.`);
    return value.trim() || null;
}
function integer(value, label, min, max) {
    if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max) throw fail(400, `Enter a valid ${label}.`);
    return Number(value);
}
function validateApplication(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Enter valid application details.');
    const name = text(body.Name, 'full name', 100), father = text(body.FatherName, "father's name", 100, false);
    const cnic = text(body.Cnic, 'CNIC', 15).replace(/-/g, '');
    if (!/^\d{13}$/.test(cnic)) throw fail(400, 'Enter a valid 13-digit CNIC.');
    const dob = text(body.DOB, 'date of birth', 10);
    const birth = new Date(`${dob}T00:00:00Z`), today = new Date();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== dob || birth > today) throw fail(400, 'Enter a valid date of birth.');
    const vehicleType = text(body.Vehicle_Type, 'vehicle type', 40);
    if (!VEHICLE_TYPES.includes(vehicleType)) throw fail(400, 'Select a supported city-to-city vehicle.');
    let services;
    try { services = JSON.parse(body.Services); } catch { throw fail(400, 'Select city-to-city services.'); }
    if (!Array.isArray(services) || !services.length || services.length > 3 || new Set(services).size !== services.length || services.some(code => !['shared', 'private', 'parcel'].includes(code))) throw fail(400, 'Select valid city-to-city services.');
    const weight = body.Max_Parcel_Weight_Kg ? Number(body.Max_Parcel_Weight_Kg) : null;
    if ((weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight > 999999.99)) || (services.includes('parcel') && weight === null)) throw fail(400, 'Enter a valid parcel weight capacity.');
    const payout = (value, label) => { const p = text(value, label, 15, false); if (p && !/^03\d{9}$/.test(p)) throw fail(400, `Enter a valid ${label}.`); return p; };
    return { name, father, cnic, dob, cityId: integer(body.Home_City_ID, 'home city', 1, 2147483647), address: text(body.Address, 'address', 1000),
        vehicleType, make: text(body.Vehicle_Make, 'vehicle make', 60, false), model: text(body.Vehicle_Model, 'vehicle model', 60),
        year: body.Manufacture_Year ? integer(body.Manufacture_Year, 'manufacture year', 1950, today.getUTCFullYear() + 1) : null,
        plate: text(body.Vehicle_Number, 'registration number', 40).toUpperCase(), color: text(body.Vehicle_Color, 'vehicle color', 30),
        seats: integer(body.Passenger_Capacity, 'passenger capacity (excluding driver)', 1, 30), services, weight,
        easypaisa: payout(body.EasyPaisa, 'EasyPaisa number'), jazzcash: payout(body.JazzCash, 'JazzCash number') };
}
function carType(value) {
    return VEHICLE_TYPES.find(type => type.toLowerCase() === String(value || '').trim().toLowerCase());
}
function validSavedCar(source) { return Boolean(carType(source?.vehicle_type) && source?.model && source?.registration_number); }
function newCar(body, files) {
    if (String(body.New_Vehicle) !== '1') return null;
    const type = carType(body.Vehicle_Type);
    if (!type) throw fail(400, 'City-to-city requires a car. Bikes and rickshaws are not allowed.');
    const vehicle = {vehicle_type:type,model:text(body.Vehicle_Model,'car model',60),registration_number:text(body.Vehicle_Number,'car registration number',40).toUpperCase(),color:text(body.Vehicle_Color,'car color',30)};
    if (!files?.Vehicle_Running_Page?.[0]?.storedPath) throw fail(400,'Upload the registration document for this car.');
    return vehicle;
}
function capacityOf(body = {}) {
    const seats = integer(body.Passenger_Capacity, 'passenger capacity (excluding driver)', 1, 30);
    const weight = Number(body.Max_Parcel_Weight_Kg);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 999999.99 || !/^\d+(?:\.\d{1,2})?$/.test(String(body.Max_Parcel_Weight_Kg))) throw fail(400, 'Enter a valid parcel weight capacity.');
    return {seats, weight};
}
function createCityToCityDrivers(pool) {
    async function transaction(action) {
        const conn = await pool.getConnection();
        try { await conn.beginTransaction(); const result = await action(conn); await conn.commit(); return result; }
        catch (error) { await conn.rollback().catch(() => {}); throw error; }
        finally { conn.release(); }
    }
    async function user(conn, userId, lock = false) {
        const [rows] = await conn.query(`SELECT User_ID_Pk, User_Name, Mobile, Email, Role, AccountDeleted FROM users WHERE User_ID_Pk = ?${lock ? ' FOR UPDATE' : ''}`, [userId]);
        const account = rows[0];
        if (!account) throw fail(401, 'Please sign in again to continue enrollment.');
        if (Number(account.AccountDeleted)) throw fail(403, 'This account is inactive. Please contact support.');
        if (['admin', 'superadmin', 'employee'].includes(String(account.Role).trim().toLowerCase())) throw fail(403, 'Use your rider or driver account to enroll.');
        return account;
    }
    async function sourceDriver(conn, owner) {
        const phone = String(owner.Mobile || '').replace(/\D/g, '').replace(/^92(?=\d{10}$)/, '0');
        const [rows] = await conn.query("SELECT id,User_ID_FK,full_name,father_name,cnic,DATE_FORMAT(dob,'%Y-%m-%d') AS dob,address,city,vehicle_type,vehicle_model,vehicle_number,vehicle_color,photo_path,cnic_front_path,cnic_back_path,license_path,vehicle_doc_path,Easypaisa,JazzCash,status FROM drivers WHERE User_ID_FK=? OR ((User_ID_FK IS NULL OR User_ID_FK=0) AND REPLACE(REPLACE(phone,'-',''),' ','')=?) ORDER BY id LIMIT 2", [owner.User_ID_Pk,phone]);
        if (rows.length > 1) throw fail(409, 'Multiple driver profiles need review. Please contact support.');
        return rows[0] || null;
    }
    async function account(conn, userId) {
        const owner = await user(conn, userId);
        const [profiles] = await conn.query("SELECT d.*, DATE_FORMAT(d.dob, '%Y-%m-%d') AS dob, c.City_Name AS city FROM city_to_city_drivers d LEFT JOIN city c ON c.ID_PK = d.home_city_id WHERE d.user_id = ?", [userId]);
        if (!profiles.length) return { exists: false, profile: null };
        const profile = profiles[0];
        const [vehicles] = await conn.query('SELECT * FROM city_to_city_vehicles WHERE city_to_city_driver_id = ? AND is_active = 1 ORDER BY id DESC', [profile.id]);
        const [services] = await conn.query('SELECT ds.service_id, s.code, s.name, ds.approval_status, ds.is_enabled FROM city_to_city_driver_services ds JOIN city_to_city_services s ON s.id = ds.service_id WHERE ds.city_to_city_driver_id = ?', [profile.id]);
        const [documents] = await conn.query('SELECT id, vehicle_id, document_type, review_status, expires_at, rejection_reason, source_driver_id, source_document_key FROM city_to_city_driver_documents WHERE city_to_city_driver_id = ? ORDER BY id DESC', [profile.id]);
        let importedVehicle = null;
        try { importedVehicle = profile.source_snapshot ? JSON.parse(profile.source_snapshot) : null; } catch { /* Keep legacy profiles readable. */ }
        return { exists: true, profile: { ...profile, imported_vehicle: importedVehicle, requires_new_vehicle: !vehicles.length && !validSavedCar(importedVehicle), name: profile.full_name || owner.User_Name, phone: owner.Mobile, email: owner.Email, vehicles, services, documents } };
    }
    async function saveCapacity(conn, profile, body, files = {}) {
        const replacement = newCar(body, files);
        const {seats,weight} = capacityOf(body);
        if (!['pending','draft','rejected','approved'].includes(profile.application_status)) throw fail(409,'Only an application under review can change vehicle capacity.');
        const [trips]=await conn.query("SELECT id FROM city_to_city_trips WHERE city_to_city_driver_id=? AND status IN ('boarding','in_progress') LIMIT 1 FOR UPDATE",[profile.id]);
        if(trips.length) throw fail(409,'Complete or cancel your active trip before changing capacity.');
        const [vehicles] = await conn.query('SELECT id FROM city_to_city_vehicles WHERE city_to_city_driver_id=? AND is_active=1 FOR UPDATE',[profile.id]);
        if (replacement) {
            await conn.query('UPDATE city_to_city_vehicles SET is_active=0 WHERE city_to_city_driver_id=?',[profile.id]);
            const [vehicle]=await conn.query("INSERT INTO city_to_city_vehicles (city_to_city_driver_id,vehicle_type,model,registration_number,color,passenger_capacity,max_parcel_weight_kg) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vehicle_type=VALUES(vehicle_type),model=VALUES(model),color=VALUES(color),passenger_capacity=VALUES(passenger_capacity),max_parcel_weight_kg=VALUES(max_parcel_weight_kg),approval_status='pending',is_active=1,id=LAST_INSERT_ID(id)",[profile.id,replacement.vehicle_type,replacement.model,replacement.registration_number,replacement.color,seats,weight]);
            await conn.query("INSERT INTO city_to_city_driver_documents (city_to_city_driver_id,vehicle_id,document_type,file_key,review_status) VALUES (?,?,'vehicle_registration',?,'pending')",[profile.id,vehicle.insertId,files.Vehicle_Running_Page[0].storedPath]);
        } else if (vehicles.length) await conn.query("UPDATE city_to_city_vehicles SET passenger_capacity=?,max_parcel_weight_kg=?,approval_status='pending' WHERE city_to_city_driver_id=? AND is_active=1",[seats,weight,profile.id]);
        else {
            let source;try{source=JSON.parse(profile.source_snapshot || '{}');}catch{source={};}
            const type=carType(source.vehicle_type);
            if (!type || !source.model || !source.registration_number) throw Object.assign(fail(400,'Register a car and upload its registration document. Your city vehicle stays unchanged.'),{code:'C2C_CAR_REQUIRED'});
            const [vehicle]=await conn.query('INSERT INTO city_to_city_vehicles (city_to_city_driver_id,vehicle_type,make,model,manufacture_year,registration_number,color,passenger_capacity,max_parcel_weight_kg) VALUES (?,?,NULL,?,NULL,?,?,?,?)',[profile.id,type,source.model,source.registration_number,source.color || null,seats,weight]);
            await conn.query("UPDATE city_to_city_driver_documents SET vehicle_id=? WHERE city_to_city_driver_id=? AND document_type='vehicle_registration' AND vehicle_id IS NULL",[vehicle.insertId,profile.id]);
        }
        for(const [field,type] of Object.entries(DOCUMENT_TYPES)) {
            if(type==='vehicle_registration') continue;
            const file=files[field]?.[0];
            if(file?.storedPath) await conn.query("INSERT INTO city_to_city_driver_documents (city_to_city_driver_id,document_type,file_key,review_status) VALUES (?,?,?,'pending')",[profile.id,type,file.storedPath]);
        }
        await conn.query("UPDATE city_to_city_drivers SET application_status='pending',is_online=0,approved_by=NULL,approved_at=NULL,rejection_reason=NULL WHERE id=?",[profile.id]);
        await conn.query("UPDATE city_to_city_driver_services SET is_enabled=0,approval_status=IF(approval_status='suspended','suspended','pending') WHERE city_to_city_driver_id=?",[profile.id]);
    }
    return {
        async options(userId, {withSource=true} = {}) { const conn = await pool.getConnection(); try { const owner = await user(conn, userId); const driver = withSource ? await sourceDriver(conn,owner) : null; const savedVehicle=driver?{vehicle_type:driver.vehicle_type,model:driver.vehicle_model,registration_number:driver.vehicle_number,color:driver.vehicle_color}:null; const [cities] = await conn.query('SELECT ID_PK, City_Name FROM city ORDER BY City_Name'); const [services] = await conn.query("SELECT id, code, name FROM city_to_city_services WHERE is_active = 1 ORDER BY sort_order"); return { cities, services, vehicle_types: VEHICLE_TYPES, existing_vehicle:savedVehicle, requires_new_vehicle:!validSavedCar(savedVehicle), existing_documents:driver?Object.entries({Photo:'photo_path',CNIC_Front:'cnic_front_path',CNIC_Back:'cnic_back_path',License:'license_path'}).filter(([,key])=>Boolean(driver[key])).map(([field])=>field):[] }; } finally { conn.release(); } },
        async account(userId) { const conn = await pool.getConnection(); try { return await account(conn, userId); } finally { conn.release(); } },
        async enrollExisting(userId, body = {}, files = {}) {
            capacityOf(body);
            const replacement = newCar(body, files);
            return transaction(async conn => {
                const owner = await user(conn,userId,true);
                const [existing] = await conn.query('SELECT id,application_status FROM city_to_city_drivers WHERE user_id=? FOR UPDATE',[userId]);
                if (existing.length) return { ...await account(conn,userId), already_submitted: true };
                const source = await sourceDriver(conn,owner);
                if (!source) throw Object.assign(fail(409,'Complete the city-to-city signup form to enroll.'),{code:'FULL_ONBOARDING_REQUIRED'});
                const [cities] = await conn.query('SELECT ID_PK FROM city WHERE LOWER(TRIM(City_Name))=LOWER(TRIM(?)) ORDER BY ID_PK LIMIT 2',[source.city || '']);
                const snapshot = { vehicle_type:source.vehicle_type, model:source.vehicle_model, registration_number:source.vehicle_number, color:source.vehicle_color, city:source.city };
                const [created] = await conn.query("INSERT INTO city_to_city_drivers (user_id,driver_code,home_city_id,source_driver_id,enrollment_source,source_snapshot,full_name,father_name,cnic,dob,address,easypaisa,jazzcash,application_status,is_online) VALUES (?,?,?,?,'city_driver',?,?,?,?,?,?,?,?,'pending',0)",[userId,`CTP_${randomUUID().slice(0,20)}`,cities.length===1?cities[0].ID_PK:null,source.id,JSON.stringify(snapshot),source.full_name || owner.User_Name,source.father_name,source.cnic,source.dob,source.address,source.Easypaisa,source.JazzCash]);
                const driverId=created.insertId;
                await conn.query('UPDATE city_to_city_drivers SET driver_code=? WHERE id=?',[formatCityToCityDriverCode(driverId),driverId]);
                const [services]=await conn.query('SELECT id,code FROM city_to_city_services WHERE is_active=1 ORDER BY sort_order');
                for(const service of services) await conn.query("INSERT INTO city_to_city_driver_services (city_to_city_driver_id,service_id,service_type,approval_status,is_enabled) VALUES (?,?,?,'pending',0)",[driverId,service.id,service.code]);
                for(const [key,type] of Object.entries({photo_path:'photo',cnic_front_path:'cnic_front',cnic_back_path:'cnic_back',license_path:'license',vehicle_doc_path:'vehicle_registration'})) {
                    if(source[key] && !(replacement && key==='vehicle_doc_path')) await conn.query("INSERT INTO city_to_city_driver_documents (city_to_city_driver_id,document_type,file_key,source_driver_id,source_document_key,review_status) VALUES (?,?,?,?,?,'pending')",[driverId,type,source[key],source.id,key]);
                }
                await saveCapacity(conn,{id:driverId,application_status:'pending',source_snapshot:JSON.stringify(snapshot)},body,files);
                return await account(conn,userId);
            });
        },
        async updateCapacity(userId, body, files = {}) {
            capacityOf(body);
            return transaction(async conn => {
                await user(conn,userId,true);
                const [rows]=await conn.query('SELECT id,application_status,source_snapshot FROM city_to_city_drivers WHERE user_id=? FOR UPDATE',[userId]);
                if(!rows.length) throw fail(404,'Application not found.');
                await saveCapacity(conn,rows[0],body,files);
                return await account(conn,userId);
            });
        },
        async register(userId, body, files = {}) {
            const data = validateApplication(body);
            return transaction(async conn => {
                await user(conn, userId, true);
                const [existing] = await conn.query('SELECT id, application_status FROM city_to_city_drivers WHERE user_id = ? FOR UPDATE', [userId]);
                if (existing.length && existing[0].application_status === 'pending') return { ...await account(conn, userId), already_submitted: true };
                if (existing.length && !['draft','rejected'].includes(existing[0].application_status)) throw fail(409, 'This application cannot be resubmitted. Contact support.');
                const [cities] = await conn.query('SELECT ID_PK FROM city WHERE ID_PK = ?', [data.cityId]);
                if (!cities.length) throw fail(400, 'Select a valid city.');
                const [services] = await conn.query(`SELECT id, code FROM city_to_city_services WHERE is_active = 1 AND code IN (${data.services.map(() => '?').join(',')})`, data.services);
                if (services.length !== data.services.length) throw fail(400, 'One of the selected services is unavailable. Refresh and try again.');
                const values = [data.cityId, data.name, data.father, data.cnic, data.dob, data.address, data.easypaisa, data.jazzcash];
                let driverId = existing[0]?.id;
                if (driverId) {
                    await conn.query("UPDATE city_to_city_drivers SET home_city_id=?, full_name=?, father_name=?, cnic=?, dob=?, address=?, easypaisa=?, jazzcash=?, application_status='pending', rejection_reason=NULL, approved_by=NULL, approved_at=NULL, is_online=0 WHERE id=?", [...values, driverId]);
                    await conn.query('UPDATE city_to_city_vehicles SET is_active = 0 WHERE city_to_city_driver_id = ?', [driverId]);
                    await conn.query("UPDATE city_to_city_driver_services SET is_enabled = 0, approval_status='suspended' WHERE city_to_city_driver_id = ?", [driverId]);
                } else {
                    const [result] = await conn.query("INSERT INTO city_to_city_drivers (user_id,driver_code,home_city_id,full_name,father_name,cnic,dob,address,easypaisa,jazzcash,application_status) VALUES (?,?,?,?,?,?,?,?,?,?,'pending')", [userId, `CTP_${randomUUID().slice(0, 20)}`, ...values]);
                    driverId = result.insertId;
                    await conn.query('UPDATE city_to_city_drivers SET driver_code=? WHERE id=?',[formatCityToCityDriverCode(driverId),driverId]);
                }
                const [vehicle] = await conn.query("INSERT INTO city_to_city_vehicles (city_to_city_driver_id,vehicle_type,make,model,manufacture_year,registration_number,color,passenger_capacity,max_parcel_weight_kg) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vehicle_type=VALUES(vehicle_type),make=COALESCE(VALUES(make),make),model=VALUES(model),manufacture_year=COALESCE(VALUES(manufacture_year),manufacture_year),color=VALUES(color),passenger_capacity=VALUES(passenger_capacity),max_parcel_weight_kg=VALUES(max_parcel_weight_kg),approval_status='pending',is_active=1,id=LAST_INSERT_ID(id)", [driverId,data.vehicleType,data.make,data.model,data.year,data.plate,data.color,data.seats,data.weight]);
                for (const service of services) await conn.query("INSERT INTO city_to_city_driver_services (city_to_city_driver_id,service_id,service_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE approval_status='pending',is_enabled=0", [driverId,service.id,service.code]);
                for (const [field, type] of Object.entries(DOCUMENT_TYPES)) {
                    const file = files[field]?.[0];
                    if (file) await conn.query('INSERT INTO city_to_city_driver_documents (city_to_city_driver_id,vehicle_id,document_type,file_key) VALUES (?,?,?,?)', [driverId, type === 'vehicle_registration' ? vehicle.insertId : null, type, file.storedPath || file.filename]);
                }
                return await account(conn, userId);
            });
        },
        async switchMode(userId, target) {
            if (!['rider','driver','city_to_city_driver'].includes(target)) throw fail(400, 'Invalid app mode.');
            return transaction(async conn => {
                const owner = await user(conn, userId, true);
                const [rides] = await conn.query(`SELECT r.Ride_ID_Pk FROM ride_history r LEFT JOIN drivers d ON d.id = r.Driver_ID_Fk WHERE (r.User_ID_Fk = ? OR d.User_ID_FK = ?) AND r.Ride_Status IN ${ACTIVE_RIDES} LIMIT 1 FOR UPDATE`, [userId, userId]);
                const [trips] = await conn.query("SELECT t.id FROM city_to_city_trips t JOIN city_to_city_drivers d ON d.id=t.city_to_city_driver_id WHERE d.user_id=? AND t.status IN ('boarding','in_progress') LIMIT 1 FOR UPDATE", [userId]);
                const [customerTrips]=await conn.query("SELECT r.id FROM city_to_city_requests r LEFT JOIN city_to_city_bookings b ON b.request_id=r.id WHERE r.customer_user_id=? AND ((r.status='open' AND r.expires_at>NOW()) OR b.status IN ('confirmed','picked_up')) LIMIT 1 FOR UPDATE",[userId]);
                if (rides.length || trips.length || customerTrips.length) throw fail(409, 'Complete or cancel your active trip before switching modes.');
                if (target === 'driver') {
                    const [drivers] = await conn.query("SELECT id FROM drivers WHERE User_ID_FK=? AND status='active'", [userId]);
                    if (!drivers.length) throw fail(403, 'An approved city driver profile is required.');
                }
                const result = await account(conn, userId);
                if (target === 'city_to_city_driver' && !result.exists) return { mode: target, needs_onboarding: true, can_reuse_driver: Boolean(await sourceDriver(conn,owner)) };
                await conn.query('UPDATE users SET last_active_mode=? WHERE User_ID_Pk=?',[target,userId]);
                if(target !== 'city_to_city_driver' && result.exists) await conn.query('UPDATE city_to_city_drivers SET is_online=0 WHERE id=?',[result.profile.id]);
                return { mode: target, needs_capacity: target === 'city_to_city_driver' && result.exists && !result.profile.vehicles?.some(v=>Number(v.passenger_capacity)>0 && Number(v.max_parcel_weight_kg)>0), ...result, user: { id: owner.User_ID_Pk, name: owner.User_Name, phone: owner.Mobile, email: owner.Email } };
            });
        },
    };
}
module.exports = { createCityToCityDrivers, validateApplication, DOCUMENT_TYPES, fail, validSavedCar };
