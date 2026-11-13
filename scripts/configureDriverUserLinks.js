const fs=require('node:fs/promises'),path=require('node:path');
async function configure(pool,{apply=false}={}){
 const [engines]=await pool.query("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('drivers','users')");
 if(engines.length!==2||engines.some(r=>r.ENGINE!=='InnoDB'))throw new Error('User link guards require InnoDB');
 const [missing]=await pool.query('SELECT d.id FROM drivers d LEFT JOIN users u ON u.User_ID_Pk=d.User_ID_FK WHERE u.User_ID_Pk IS NULL LIMIT 1');
 if(missing.length)throw new Error('Existing orphan driver links need review before installing constraints');
 if(!apply)return {read_only:true,message:'Use --apply to install FK and insert/update guards. Existing ownership is preserved.'};
 const [indexes]=await pool.query("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='drivers' AND COLUMN_NAME='User_ID_FK' AND SEQ_IN_INDEX=1");
 if(!indexes.length)await pool.query('ALTER TABLE drivers ADD INDEX ix_drivers_personal_user (User_ID_FK)');
 const [fks]=await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='drivers' AND COLUMN_NAME='User_ID_FK' AND REFERENCED_TABLE_NAME='users'");
 if(!fks.length)await pool.query('ALTER TABLE drivers ADD CONSTRAINT fk_drivers_personal_user FOREIGN KEY (User_ID_FK) REFERENCES users(User_ID_Pk) ON DELETE RESTRICT ON UPDATE RESTRICT');
 const sql=await fs.readFile(path.join(__dirname,'../db/migrations/guard_driver_user_links.sql'),'utf8');
 for(const statement of sql.split('-- @statement'))await pool.query(statement);
 const [triggers]=await pool.query("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('guard_driver_user_insert','guard_driver_user_update')");
 if(triggers.length!==2)throw new Error('Driver user guards failed verification');
 return {guards_installed:true,existing_ownership_changed:false};
}
if(require.main===module){const pool=require('../db/Connect_Db');configure(pool,{apply:process.argv.includes('--apply')}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>pool.end());}
module.exports={configure};
