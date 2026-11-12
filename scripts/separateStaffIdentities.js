// Explicit maintenance migration. Never changes a users row or its role/password.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const tables = {
    employee: ['created_by','updated_by'], employee_role: ['created_by','updated_by'],
    employee_function: ['created_by','updated_by'], assign_role: ['created_by','updated_by'], assign_role_function: ['created_by','updated_by'],
    fare_policy: ['created_by','updated_by'], admin_setting_audit: ['created_by'],
    city_to_city_services: ['created_by','updated_by'], city_to_city_fare_rates: ['created_by','updated_by'],
    city_to_city_drivers: ['approved_by'], city_to_city_driver_documents: ['reviewed_by'],
    notifications: ['Created_By'], notification_templates: ['Created_By'],
};
const quote = value => '`' + value.replace(/`/g,'``') + '`';
async function migrate(conn, { apply = false, backupDir = path.join(__dirname,'../private_uploads/staff-migrations'), maintenanceMarker = require('../utils/staffMaintenance').marker } = {}) {
    const [columns] = await conn.query('SHOW COLUMNS FROM employee');
    if (!columns.some(row=>row.Field==='user_id')) {
        if(apply) {
            const [wallet]=await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='driver_wallet'");
            if(wallet.length) {
                await conn.query('ALTER TABLE driver_wallet ADD COLUMN IF NOT EXISTS created_by_employee_id BIGINT UNSIGNED NULL');
                const [keys]=await conn.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='driver_wallet' AND COLUMN_NAME='created_by_employee_id' AND REFERENCED_TABLE_NAME='employee'");
                if(!keys.length) await conn.query('ALTER TABLE driver_wallet ADD CONSTRAINT fk_wallet_staff_actor FOREIGN KEY (created_by_employee_id) REFERENCES employee(emp_id)');
            }
            await conn.query('DROP TABLE IF EXISTS staff_identity_upgrade_state');
            await fs.unlink(maintenanceMarker).catch(()=>{});
        }
        return { already_separated: true };
    }
    // Maintenance mode is required: DDL commits implicitly in MySQL/MariaDB.
    const [keys] = await conn.query("SELECT TABLE_NAME,COLUMN_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='users'");
    const [schema] = await conn.query('SELECT TABLE_NAME,COLUMN_NAME,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
    const available = new Map(schema.map(row=>[`${row.TABLE_NAME}.${row.COLUMN_NAME}`,row]));
    const targets = Object.entries(tables).flatMap(([table,cols])=>cols.filter(col=>available.has(`${table}.${col}`)).map(column=>({table,column,nullable:available.get(`${table}.${column}`).IS_NULLABLE==='YES'})));
    if (!apply) return { requires_maintenance:true, audit_columns: targets.map(row=>`${row.table}.${row.column}`), action:'Copy staff credentials and grants; move audit actors to employee IDs; remove employee.user_id. users rows remain untouched.' };
    const [lock] = await conn.query("SELECT GET_LOCK('goride_staff_identity_upgrade',0) AS acquired");
    if (!Number(lock[0].acquired)) throw new Error('Another staff migration is running.');
    try {
        await conn.query("CREATE TABLE IF NOT EXISTS staff_identity_upgrade_state (id INT PRIMARY KEY, phase VARCHAR(30) NOT NULL, payload LONGTEXT NOT NULL)");
        await fs.mkdir(path.dirname(maintenanceMarker),{recursive:true,mode:0o700});
        await fs.writeFile(maintenanceMarker,'Staff identity upgrade in progress\n',{mode:0o600});
        const [saved] = await conn.query('SELECT phase,payload FROM staff_identity_upgrade_state WHERE id=1');
        let state = saved.length ? JSON.parse(saved[0].payload) : null;
        let phase = saved[0]?.phase;
        if (!state) {
            const [employees] = await conn.query('SELECT * FROM employee');
            const [users] = await conn.query('SELECT User_ID_Pk,User_Name,Email,Mobile,Password,Role,AccountDeleted FROM users');
            const byId = new Map(users.map(row=>[Number(row.User_ID_Pk),row]));
            const legacy = users.filter(row=>['admin','superadmin','employee'].includes(String(row.Role).trim().toLowerCase()));
            const actors = [];
            for (const target of targets) {
                const [rows] = await conn.query(`SELECT DISTINCT ${quote(target.column)} AS actor FROM ${quote(target.table)} WHERE ${quote(target.column)} IS NOT NULL`);
                actors.push(...rows.map(row=>Number(row.actor)));
            }
            const [wallet] = available.has('driver_wallet.created_by') ? await conn.query("SELECT DISTINCT created_by AS actor FROM driver_wallet WHERE reference_id LIKE 'ADMIN_TOPUP_%' AND created_by IS NOT NULL") : [[]];
            actors.push(...wallet.map(row=>Number(row.actor)));
            const required = new Set([...legacy.map(row=>Number(row.User_ID_Pk)),...employees.map(row=>Number(row.user_id)),...actors.filter(Boolean)]);
            for (const id of required) if (!byId.has(id)) throw new Error(`Missing historical actor ${id}; resolve its attribution before migrating.`);
            const map = Object.fromEntries(employees.map(row=>[row.user_id,Number(row.emp_id)]));
            let next = Math.max(0,...employees.map(row=>Number(row.emp_id)))+1;
            const credentials = [...required].map(id=>{
                const user=byId.get(id), existing=employees.find(row=>Number(row.user_id)===id);
                const role=String(user.Role).trim().toLowerCase();
                const superadmin = ['admin','superadmin'].includes(role) && !existing;
                const active = !Number(user.AccountDeleted) && (existing ? Number(existing.is_active)&&!Number(existing.is_deleted) : superadmin);
                if (!map[id]) map[id]=next++;
                return {emp_id:map[id],legacy_id:id,existing:!!existing,name:user.User_Name || 'Archived staff',email:existing?.email || user.Email,phone:existing?.phone || user.Mobile || '',password_hash:user.Password || null,account_type:superadmin?'superadmin':'employee',is_active:active?1:0,is_deleted:existing?.is_deleted || 0};
            });
            const emails=credentials.map(row=>String(row.email||'').trim().toLowerCase());
            if(emails.some(email=>!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || new Set(emails).size!==emails.length) throw new Error('Legacy staff emails are missing or ambiguous. Resolve before migration; no accounts have been changed.');
            if(!credentials.some(row=>row.account_type==='superadmin'&&row.is_active&&/^\$2[aby]\$/.test(row.password_hash||''))) throw new Error('An active super administrator with a bcrypt password is required before separation.');
            state={map,credentials,targets};
            await fs.mkdir(backupDir,{recursive:true,mode:0o700});
            const backupFile=path.join(backupDir,`staff-identities-${randomUUID()}.json`);
            await fs.writeFile(backupFile,JSON.stringify({employees,...state}),{mode:0o600});
            await conn.query("INSERT INTO staff_identity_upgrade_state (id,phase,payload) VALUES (1,'prepared',?)",[JSON.stringify(state)]);
            phase='prepared';
            console.log('Private recovery snapshot saved. Keep it outside public uploads.');
        }
        if(phase==='prepared') {
            // All audited values retain their legacy IDs until the transactional remap.
            for(const key of keys) if ((key.TABLE_NAME==='employee'&&key.COLUMN_NAME==='user_id') || state.targets.some(t=>t.table===key.TABLE_NAME&&t.column===key.COLUMN_NAME)) await conn.query(`ALTER TABLE ${quote(key.TABLE_NAME)} DROP FOREIGN KEY ${quote(key.CONSTRAINT_NAME)}`);
            await conn.query("ALTER TABLE employee MODIFY user_id INT NULL, ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL, ADD COLUMN IF NOT EXISTS account_type ENUM('employee','superadmin') NOT NULL DEFAULT 'employee'");
            for(const t of state.targets) await conn.query(`ALTER TABLE ${quote(t.table)} MODIFY ${quote(t.column)} BIGINT UNSIGNED ${t.nullable?'NULL':'NOT NULL'}`);
            if(available.has('driver_wallet.created_by')) await conn.query('ALTER TABLE driver_wallet ADD COLUMN IF NOT EXISTS created_by_employee_id BIGINT UNSIGNED NULL');
            await conn.beginTransaction();
            try {
                for(const row of state.credentials) {
                    if(row.existing) await conn.query('UPDATE employee SET password_hash=?,account_type=?,is_active=? WHERE emp_id=?',[row.password_hash,row.account_type,row.is_active,row.emp_id]);
                    else await conn.query('INSERT INTO employee (emp_id,name,email,phone,password_hash,account_type,is_active,is_deleted) VALUES (?,?,?,?,?,?,?,?)',[row.emp_id,row.name,row.email,row.phone,row.password_hash,row.account_type,row.is_active,row.is_deleted]);
                }
                const entries=Object.entries(state.map);
                const cases=entries.map(()=> 'WHEN ? THEN ?').join(' '),args=entries.flatMap(([a,b])=>[Number(a),b]);
                for(const t of state.targets) await conn.query(`UPDATE ${quote(t.table)} SET ${quote(t.column)}=CASE ${quote(t.column)} ${cases} ELSE NULL END WHERE ${quote(t.column)} IS NOT NULL`,args);
                if(available.has('driver_wallet.created_by')) await conn.query(`UPDATE driver_wallet SET created_by_employee_id=CASE created_by ${cases} ELSE NULL END WHERE reference_id LIKE 'ADMIN_TOPUP_%'`,args);
                await conn.query("UPDATE staff_identity_upgrade_state SET phase='remapped' WHERE id=1");
                await conn.commit();phase='remapped';
            }catch(error){await conn.rollback();throw error;}
        }
        if(phase==='remapped') {
            const [existingKeys]=await conn.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='employee'");
            for(const t of state.targets) if(!existingKeys.some(k=>k.TABLE_NAME===t.table&&k.COLUMN_NAME===t.column)) await conn.query(`ALTER TABLE ${quote(t.table)} ADD CONSTRAINT ${quote(`fk_staff_${t.table}_${t.column}`)} FOREIGN KEY (${quote(t.column)}) REFERENCES employee(emp_id)`);
            if(available.has('driver_wallet.created_by')&&!existingKeys.some(k=>k.TABLE_NAME==='driver_wallet'&&k.COLUMN_NAME==='created_by_employee_id')) await conn.query('ALTER TABLE driver_wallet ADD CONSTRAINT fk_wallet_staff_actor FOREIGN KEY (created_by_employee_id) REFERENCES employee(emp_id)');
            await conn.query('ALTER TABLE employee DROP COLUMN user_id');
            await conn.query('DROP TABLE staff_identity_upgrade_state');
        }
        await fs.unlink(maintenanceMarker).catch(()=>{});
        return {separated:true,staff_accounts:state.credentials.length};
    }finally{await conn.query("SELECT RELEASE_LOCK('goride_staff_identity_upgrade')");}
}
if(require.main===module) {
    const pool=require('../db/Connect_Db');
    (async()=>{let conn;try{conn=await pool.getConnection();console.log(await migrate(conn,{apply:process.argv.includes('--apply')}));}finally{conn?.release();await pool.end();}})().catch(error=>{console.error('Staff separation failed:',error.code||error.message);process.exitCode=1;});
}
module.exports={migrate,tables};
