// Bootstrap a fresh installation without ever creating a users row.
require('dotenv').config();
const bcrypt=require('bcryptjs');
const {validateEmployee}=require('../services/adminEmployees');
async function main(){
    if(!process.argv.includes('--create')) {console.log('Set STAFF_ADMIN_NAME, STAFF_ADMIN_EMAIL, STAFF_ADMIN_PHONE and STAFF_ADMIN_PASSWORD privately, then pass --create. No database changes made.');return;}
    const data=validateEmployee({name:process.env.STAFF_ADMIN_NAME,email:process.env.STAFF_ADMIN_EMAIL,phone:process.env.STAFF_ADMIN_PHONE,password:process.env.STAFF_ADMIN_PASSWORD,account_type:'superadmin'},true);
    const hash=await bcrypt.hash(process.env.STAFF_ADMIN_PASSWORD,12);
    const pool=require('../db/Connect_Db');let conn;
    try{conn=await pool.getConnection();await conn.beginTransaction();
        const [lock]=await conn.query("SELECT GET_LOCK('goride_staff_bootstrap',0) AS acquired");if(!Number(lock[0].acquired))throw new Error('Staff bootstrap is already running.');
        const [rows]=await conn.query("SELECT emp_id FROM employee WHERE account_type='superadmin' AND is_active=1 AND is_deleted=0 LIMIT 1 FOR UPDATE");
        if(rows.length)throw new Error('A super administrator already exists. Use Employee access to create more staff.');
        await conn.query("INSERT INTO employee (name,email,phone,password_hash,account_type) VALUES (?,?,?,?,'superadmin')",[data.name,data.email,data.phone,hash]);
        await conn.commit();console.log('Independent super administrator created. Sign in through the admin panel.');
    }catch(e){await conn?.rollback();throw e;}finally{if(conn){await conn.query("SELECT RELEASE_LOCK('goride_staff_bootstrap')");conn.release();}await pool.end();}
}
main().catch(e=>{console.error('Staff bootstrap failed:',e.code||e.message);process.exitCode=1;});
