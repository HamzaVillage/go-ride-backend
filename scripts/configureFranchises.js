const fs=require('node:fs/promises');
const path=require('node:path');
async function configure(conn,{apply=false}={}) {
  const file=path.join(__dirname,'../db/migrations/add_admin_operations.sql');
  if (!apply) { console.log('Franchise setup dry run: installs staff assignment and member request tables; preserves existing records. Run with --apply to install.'); return; }
  const sql=(await fs.readFile(file,'utf8')).replace(/^\s*--.*$/gm,'');
  for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await conn.query(statement);
  // Existing franchise links are reused; indexes keep large tenant directories efficient.
  for (const [table,key] of [['drivers','id'],['users','User_ID_Pk']]) {
    const [indexes]=await conn.query(`SHOW INDEX FROM ${table}`);
    if (!indexes.some(i=>Number(i.Seq_in_index)===1 && i.Column_name==='Franchiser_ID_FK')) {
      await conn.query(`ALTER TABLE ${table} ADD INDEX idx_${table}_franchise_directory (Franchiser_ID_FK,${key})`);
    }
  }
}
if (require.main === module) {
  (async()=>{if (!process.argv.includes('--apply')) return configure(null); const pool=require('../db/Connect_Db');try{await configure(pool,{apply:true});console.log('Franchise storage installed. Restart the backend.');}finally{await pool.end();}})().catch(e=>{console.error('Franchise setup failed:',e.code||e.message);process.exitCode=1;});
}
module.exports={configure};
