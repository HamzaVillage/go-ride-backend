// Read-only by design: never changes ownership, creates users or moves wallet balances.
const {phoneOf}=require('../services/appUserIdentity');
async function audit(pool){
 const [drivers]=await pool.query('SELECT d.id,d.User_ID_FK,d.phone,u.User_ID_Pk,u.Mobile,u.Role,u.AccountDeleted FROM drivers d LEFT JOIN users u ON u.User_ID_Pk=d.User_ID_FK');
 const [users]=await pool.query('SELECT User_ID_Pk,Mobile FROM users');
 const [city]=await pool.query('SELECT d.id,d.user_id,u.User_ID_Pk FROM city_to_city_drivers d LEFT JOIN users u ON u.User_ID_Pk=d.user_id');
 const counts=new Map();for(const d of drivers)counts.set(d.User_ID_FK,(counts.get(d.User_ID_FK)||0)+1);
 const issues=[];for(const d of drivers){const reasons=[];if(!d.User_ID_Pk)reasons.push('missing_user');if(!phoneOf(d.phone)||!phoneOf(d.Mobile))reasons.push('invalid_phone_format');else if(phoneOf(d.phone)!==phoneOf(d.Mobile))reasons.push('phone_mismatch');if(counts.get(d.User_ID_FK)>1)reasons.push('shared_user_id');if(Number(d.AccountDeleted))reasons.push('deleted_user');if(['admin','superadmin','employee'].includes(String(d.Role||'').trim().toLowerCase()))reasons.push('staff_identity');if(reasons.length)issues.push({driver_id:d.id,current_user_id:d.User_ID_FK,reasons,phone_matching_user_ids:users.filter(u=>phoneOf(d.phone)&&phoneOf(u.Mobile)===phoneOf(d.phone)).map(u=>u.User_ID_Pk)});}
 const cityCounts=new Map();for(const d of city)cityCounts.set(d.user_id,(cityCounts.get(d.user_id)||0)+1);
 return {normal_profiles:drivers.length,city_profiles:city.length,normal_issues:issues,city_issues:city.filter(d=>!d.User_ID_Pk||cityCounts.get(d.user_id)>1).map(d=>({driver_id:d.id,user_id:d.user_id})),read_only:true};
}
if(require.main===module){const pool=require('../db/Connect_Db');audit(pool).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>pool.end());}
module.exports={audit};
