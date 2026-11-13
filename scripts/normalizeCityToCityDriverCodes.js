const {randomUUID}=require('node:crypto');
const {formatCityToCityDriverCode}=require('../services/cityToCityDriverCode');
async function main(){const pool=require('../db/Connect_Db');let c;try{
 c=await pool.getConnection();await c.beginTransaction();
 const [rows]=await c.query('SELECT id,driver_code FROM city_to_city_drivers ORDER BY id FOR UPDATE');
 const changed=rows.filter(r=>r.driver_code!==formatCityToCityDriverCode(r.id));
 if(!process.argv.includes('--apply')){console.log('Proposed driver code changes:',changed.map(r=>({id:r.id,driver_code:formatCityToCityDriverCode(r.id)})));await c.rollback();return;}
 // Temporary unique values avoid collisions when correcting previously swapped codes.
 for(const r of changed)await c.query('UPDATE city_to_city_drivers SET driver_code=? WHERE id=?',[`CTP_${randomUUID().slice(0,20)}`,r.id]);
 for(const r of changed)await c.query('UPDATE city_to_city_drivers SET driver_code=? WHERE id=?',[formatCityToCityDriverCode(r.id),r.id]);
 await c.commit();console.log('Updated city-to-city driver codes:',changed.map(r=>({id:r.id,driver_code:formatCityToCityDriverCode(r.id)})));
}catch(e){if(c)await c.rollback().catch(()=>{});throw e;}finally{c?.release();await pool.end();}}
main().catch(e=>{console.error('Driver-code update failed:',e.code||e.message);process.exitCode=1;});
