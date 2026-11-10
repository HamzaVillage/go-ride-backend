const { enabled: employeeAccessEnabled, getAccess } = require('./employeeAccess');
const crypto = require('node:crypto');
const {formatDriverCode} = require('../utils/driverHelper');
const fail = (status,message,code) => Object.assign(new Error(message),{status,code});
const DOCUMENTS = [
    {key:'photo',column:'photo_path',label:'Photo',required:true},
    {key:'cnic_front',column:'cnic_front_path',label:'CNIC front',required:true},
    {key:'cnic_back',column:'cnic_back_path',label:'CNIC back',required:true},
    {key:'license',column:'license_path',label:'Driving license',required:true},
    {key:'vehicle_registration',column:'vehicle_doc_path',label:'Vehicle registration',required:false},
    {key:'fingerprint',column:'fingerprint_path',label:'Fingerprint document',required:false},
];
const FIELDS={full_name:['full_name',100],father_name:['father_name',100],cnic:['cnic',15],phone:['phone',15],email:['email',100],address:['address',1000],city:['city',50],dob:['dob',10],vehicle_type:['vehicle_type',20],vehicle_model:['vehicle_model',50],vehicle_number:['vehicle_number',20],vehicle_color:['vehicle_color',30],join_date:['join_date',10],status:['status',20],is_available:['Is_Available',0]};
const profileColumns = `id, User_ID_FK AS user_id, full_name, father_name, cnic, phone, email, address, city,
    DATE_FORMAT(dob,'%Y-%m-%d') AS dob, vehicle_type, vehicle_model, vehicle_number, vehicle_color,
    LOWER(status) AS status, DATE_FORMAT(join_date,'%Y-%m-%d') AS join_date, Rating AS rating,
    Is_Available, Is_Online, completed_rides_count, updated_at, ${DOCUMENTS.map(d=>d.column).join(', ')}`;
const idOf = value => {if(!['string','number'].includes(typeof value)||!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>2147483647)throw fail(400,'Invalid driver ID.');return Number(value);};
const writesEnabled = () => process.env.ADMIN_DRIVER_PROFILE_WRITES_ENABLED === 'true';
function assertWritesEnabled(enabled = writesEnabled()) {if(!enabled)throw fail(423,'Driver profile and document saving is disabled on this server. You can inspect details and preview changes.','DRIVER_WRITES_DISABLED');}
const versionOf = row => crypto.createHash('sha256').update(JSON.stringify([row.updated_at,...Object.values(FIELDS).map(([col])=>row[col]),...DOCUMENTS.map(doc=>row[doc.column])])).digest('hex');
function approvalMissing(row) {
    const missing=DOCUMENTS.filter(doc=>doc.required&&!row[doc.column]?.trim()).map(doc=>doc.label);
    for(const [field,label] of [['full_name','Full name'],['phone','Phone'],['cnic','CNIC'],['vehicle_type','Vehicle type'],['vehicle_number','Vehicle number']])if(!row[field]?.trim())missing.push(label);
    return missing;
}
function normalizeProfile(row,enabled) {
    return {id:row.id,user_id:row.user_id,driver_code:formatDriverCode(row.id),...Object.fromEntries(Object.keys(FIELDS).filter(key=>key!=='is_available').map(key=>[key,row[FIELDS[key][0]]??''])),
        is_available:Boolean(Number(row.Is_Available)),is_online:Boolean(Number(row.Is_Online)),rating:row.rating==null?null:Number(row.rating),completed_rides:Number(row.completed_rides_count||0),version:versionOf(row),writes_enabled:enabled,
        approval_missing:approvalMissing(row),documents:DOCUMENTS.map(doc=>({key:doc.key,label:doc.label,required:doc.required,present:Boolean(row[doc.column]?.trim())}))};
}
function validateChanges(changes) {
    if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length)throw fail(400,'Choose at least one profile change.');
    const result={};
    for(const [key,value] of Object.entries(changes)) {
        if(!Object.hasOwn(FIELDS,key))throw fail(400,`The field ${key} cannot be edited here.`);
        if(key==='is_available'){if(typeof value!=='boolean')throw fail(400,'Availability must be true or false.');result.Is_Available=value?1:0;continue;}
        if(typeof value!=='string'||value.length>FIELDS[key][1]||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw fail(400,`Invalid ${key.replaceAll('_',' ')}.`);
        let text=value.trim();
        if(key==='full_name'&&!text)throw fail(400,'Full name is required.');
        if(key==='phone'){text=text.replace(/[ -]/g,'');if(!/^\+?\d{7,15}$/.test(text)||text.length>15)throw fail(400,'Enter a valid phone number with at most 15 characters.');}
        if(key==='cnic'&&text&&!/^(\d{13}|\d{5}-\d{7}-\d)$/.test(text))throw fail(400,'Enter a 13-digit CNIC, optionally formatted with hyphens.');
        if(key==='email'&&text&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))throw fail(400,'Enter a valid email address.');
        if(['dob','join_date'].includes(key)&&text){const date=new Date(`${text}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==text||text>new Date(Date.now()+18000000).toISOString().slice(0,10))throw fail(400,`Enter a valid ${key==='dob'?'birth':'joining'} date that is not in the future.`);}
        if(key==='status'){text=text.toLowerCase();if(!['unverified','pending','active','inactive','blocked'].includes(text))throw fail(400,'Invalid driver account status.');text=text[0].toUpperCase()+text.slice(1);}
        result[FIELDS[key][0]]=text||null;
    }
    return result;
}
function createAdminDriverProfiles(pool,{enabled=writesEnabled}={}) {
    const requireWrites=()=>assertWritesEnabled(enabled());
    async function getRow(conn,id,lock=false){const [rows]=await conn.query(`SELECT ${profileColumns} FROM drivers WHERE id = ?${lock?' FOR UPDATE':''}`,[id]);if(!rows.length)throw fail(404,'Driver not found.');return rows[0];}
    async function mutate(id,actor,version,action){
        requireWrites();id=idOf(id);actor=idOf(actor);
        if(typeof version!=='string'||!/^[a-f0-9]{64}$/.test(version))throw fail(400,'Reload the driver profile before saving.');
        let conn;let started=false;
        try {
            conn=await pool.getConnection();await conn.beginTransaction();started=true;
            const [admins]=await conn.query("SELECT User_ID_Pk FROM users WHERE User_ID_Pk = ? AND LOWER(TRIM(Role)) IN ('admin', 'employee') AND COALESCE(AccountDeleted,0) = 0 LOCK IN SHARE MODE",[actor]);
            if(!admins.length)throw fail(403,'An active admin account is required.');
                if (employeeAccessEnabled()) { const access = await getAccess(conn, actor, { lock: true }); if (!access.functions.includes('drivers')) throw fail(403, 'Driver screen access is required.'); }
            const row=await getRow(conn,id,true);if(versionOf(row)!==version)throw fail(409,'This driver was changed elsewhere. Reload the latest profile and review your changes again.','PROFILE_CONFLICT');
            await action(conn,row,id);const fresh=await getRow(conn,id);await conn.commit();started=false;
            console.info('Admin driver change saved',{adminId:actor,driverId:id});
            return normalizeProfile(fresh,enabled());
        }catch(error){if(started){try{await conn.rollback();}catch{}}throw error;}finally{if(conn)conn.release();}
    }
    return {
        requireWrites,
        async detail(id){id=idOf(id);let conn;try{conn=await pool.getConnection();return normalizeProfile(await getRow(conn,id),enabled());}finally{if(conn)conn.release();}},
        async update(id,actor,body={}){
            requireWrites();if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Invalid profile changes.');
            const changes=validateChanges(body.changes);
            return mutate(id,actor,body.version,async(conn,row,driverId)=>{
                const next={...row,...changes};
                if(changes.status?.toLowerCase()==='active'&&row.status?.toLowerCase()!=='active'){
                    const missing=approvalMissing(next);if(missing.length)throw fail(400,`Complete these items before approving: ${missing.join(', ')}.`);
                }
                if(changes.phone&&changes.phone!==row.phone){const [duplicates]=await conn.query("SELECT id FROM drivers WHERE REPLACE(REPLACE(phone,'-',''),' ','') = ? AND id <> ? LIMIT 1",[changes.phone,driverId]);if(duplicates.length)throw fail(409,'Another driver already uses this phone number.');}
                await conn.query(`UPDATE drivers SET ${Object.keys(changes).map(key=>`${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,[...Object.values(changes),driverId]);
            });
        },
        async documentSource(id,key){id=idOf(id);const doc=DOCUMENTS.find(item=>item.key===key);if(!doc)throw fail(404,'Unknown document type.');let conn;try{conn=await pool.getConnection();const row=await getRow(conn,id);if(!row[doc.column]?.trim())throw fail(404,'This document has not been uploaded.');return row[doc.column].trim();}finally{if(conn)conn.release();}},
        async attachDocument(id,actor,key,version,storedPath,replace=false){
            requireWrites();const doc=DOCUMENTS.find(item=>item.key===key);if(!doc)throw fail(400,'Unknown document type.');
            return mutate(id,actor,version,async(conn,row,driverId)=>{if(row[doc.column]?.trim()&&!replace)throw fail(409,'This document already exists. Choose Replace document explicitly.');await conn.query(`UPDATE drivers SET ${doc.column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,[storedPath,driverId]);});
        },
    };
}
module.exports={createAdminDriverProfiles,DOCUMENTS,assertWritesEnabled,writesEnabled,idOf,validateChanges,versionOf,fail};
