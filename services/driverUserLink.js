const {phoneOf}=require('./appUserIdentity');
const {fail}=require('./employeeAccess');
async function assertDriverUserLink(conn,{user_id,User_ID_FK,phone}) {
 const id=Number(user_id||User_ID_FK);
 if(!Number.isSafeInteger(id)||id<=0)throw fail(409,'Driver personal-account link is missing. Correct the user link before approval.');
 const [users]=await conn.query('SELECT User_ID_Pk,Mobile,Role,AccountDeleted FROM users WHERE User_ID_Pk=? FOR UPDATE',[id]);
 const owner=users[0];
 if(!owner||Number(owner.AccountDeleted)||['admin','superadmin','employee'].includes(String(owner.Role||'').trim().toLowerCase()))throw fail(409,'Driver must be linked to an active personal account before approval.');
 if(!phoneOf(phone)||phoneOf(phone)!==phoneOf(owner.Mobile))throw fail(409,'Driver phone does not match the linked personal account. Correct the user link before approval.');
 const [profiles]=await conn.query('SELECT id FROM drivers WHERE User_ID_FK=? LIMIT 2',[id]);
 if(profiles.length!==1)throw fail(409,'Multiple driver profiles share this personal account. Review the user links before approval.');
 return owner;
}
module.exports={assertDriverUserLink};
