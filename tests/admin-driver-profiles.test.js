const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');const jwt=require('jsonwebtoken');const {once}=require('node:events');
const {createAdminDriverProfiles,versionOf,validateChanges,DOCUMENTS}=require('../services/adminDriverProfiles');
const {createAdminRouter}=require('../routers/admin');
function fixture({enabled=false,missing=false,duplicate=false,activeAdmin=true}={}){
    const row={id:10,user_id:20,full_name:'Fixture Driver',father_name:'Fixture Father',cnic:'12345-1234567-1',phone:'03001234567',email:'fixture@example.test',city:'Karachi',address:'Fixture address',dob:'1990-01-01',vehicle_type:'mini',vehicle_model:'Alto 2020',vehicle_number:'ABC-123',vehicle_color:'White',join_date:'2026-01-01',status:'pending',Is_Available:1,Is_Online:0,rating:4,completed_rides_count:10,updated_at:'2026-11-06 10:00:00',password:'never-return',JazzCash:'never-return',photo_path:'old-photo.png',cnic_front_path:missing?null:'old-front.png',cnic_back_path:'old-back.png',license_path:'old-license.png'};
    const state={calls:0,writes:[],released:0,rolledBack:0,committed:0};let backup;
    const pool={async getConnection(){state.calls++;return {async beginTransaction(){backup={...row};},async commit(){state.committed++;},async rollback(){Object.assign(row,backup);state.rolledBack++;},release(){state.released++;},async query(sql,args){
        if(sql.includes('FROM employee WHERE'))return [activeAdmin?[{emp_id:7,account_type:'superadmin',is_active:1,is_deleted:0}]:[]];
        if(sql.startsWith('SELECT id FROM drivers'))return [duplicate?[{id:99}]:[]];
        if(sql.startsWith('SELECT'))return [[{...row}]];
        if(sql.startsWith('UPDATE drivers')){state.writes.push({sql,args});const names=[...sql.matchAll(/(?:SET |, )(\w+) = \?/g)].map(match=>match[1]);names.forEach((key,index)=>{row[key]=key==='status'?args[index].toLowerCase():args[index];});return [{affectedRows:1}];}
        throw new Error('Unexpected SQL');
    }};}};
    return {row,state,pool,service:createAdminDriverProfiles(pool,{enabled:()=>enabled})};
}
test('profile reads expose needed fields and document metadata but no secrets or raw paths',async()=>{
    const f=fixture();const profile=await f.service.detail(10);assert.equal(profile.cnic,'12345-1234567-1');assert.equal(profile.writes_enabled,false);assert.equal(profile.documents.length,6);assert.equal(profile.documents.filter(doc=>doc.required&&doc.present).length,4);assert.match(profile.version,/^[a-f0-9]{64}$/);assert.equal(profile.password,undefined);assert.equal(profile.JazzCash,undefined);assert.equal(profile.photo_path,undefined);assert.equal(f.state.writes.length,0);assert.equal(f.state.released,1);
});
test('default read-only guards reject updates and attachments before touching DB',async()=>{
    const f=fixture();await assert.rejects(f.service.update(10,7,{version:versionOf(f.row),changes:{status:'active'}}),{status:423});await assert.rejects(f.service.attachDocument(10,7,'photo',versionOf(f.row),'new.png'),{status:423});assert.equal(f.state.calls,0);
});
test('whitelisted profile changes preserve roles, credentials, wallet, and old documents',async()=>{
    const f=fixture({enabled:true});const result=await f.service.update(10,7,{version:versionOf(f.row),changes:{full_name:'Updated fixture',vehicle_color:'Blue',is_available:false}});assert.equal(result.full_name,'Updated fixture');assert.equal(result.is_available,false);assert.equal(f.row.photo_path,'old-photo.png');assert.equal(f.row.password,'never-return');assert.equal(f.state.committed,1);assert.doesNotMatch(f.state.writes[0].sql,/users|wallet|Role|password/);
});
test('stale drafts fail without overwriting newer data',async()=>{
    const f=fixture({enabled:true});const version=versionOf(f.row);f.row.city='Newer city';await assert.rejects(f.service.update(10,7,{version,changes:{city:'Old draft'}}),{status:409});assert.equal(f.row.city,'Newer city');assert.equal(f.state.writes.length,0);
});
test('approval refuses incomplete documents, then permits complete profiles',async()=>{
    const missing=fixture({enabled:true,missing:true});await assert.rejects(missing.service.update(10,7,{version:versionOf(missing.row),changes:{status:'active'}}),error=>error.status===400&&error.message.includes('CNIC front'));assert.equal(missing.state.writes.length,0);
    const ready=fixture({enabled:true});const result=await ready.service.update(10,7,{version:versionOf(ready.row),changes:{status:'active'}});assert.equal(result.status,'active');
});
test('document replacement must be explicit and preserves unrelated document columns',async()=>{
    const f=fixture({enabled:true});await assert.rejects(f.service.attachDocument(10,7,'photo',versionOf(f.row),'replacement.png'),{status:409});
    await f.service.attachDocument(10,7,'photo',versionOf(f.row),'replacement.png',true);assert.equal(f.row.photo_path,'replacement.png');assert.equal(f.row.cnic_front_path,'old-front.png');assert.equal(f.state.writes.length,1);
});
test('invalid or protected fields are rejected before DB updates',()=>{
    for(const changes of [{role:'admin'},{password:'new'},{wallet_balance:100},{phone:'abc'},{email:'bad'},{status:'deleted'},{dob:'2026-02-31'},{cnic:'bad'},{is_available:'true'},{full_name:''}])assert.throws(()=>validateChanges(changes),{status:400});
});
test('duplicate phones and revoked admin access cannot change a profile',async()=>{
    const duplicate=fixture({enabled:true,duplicate:true});await assert.rejects(duplicate.service.update(10,7,{version:versionOf(duplicate.row),changes:{phone:'03009999999'}}),{status:409});assert.equal(duplicate.state.writes.length,0);
    const revoked=fixture({enabled:true,activeAdmin:false});await assert.rejects(revoked.service.update(10,7,{version:versionOf(revoked.row),changes:{city:'Lahore'}}),{status:401});assert.equal(revoked.state.writes.length,0);
});
test('HTTP profile and upload writes are blocked before parsing files or acquiring profile data',async t=>{
    const oldSecret=process.env.JWT_SECRET,oldFlag=process.env.ADMIN_DRIVER_PROFILE_WRITES_ENABLED;process.env.JWT_SECRET='fixture-profile-secret';delete process.env.ADMIN_DRIVER_PROFILE_WRITES_ENABLED;
    t.after(()=>{if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;if(oldFlag===undefined)delete process.env.ADMIN_DRIVER_PROFILE_WRITES_ENABLED;else process.env.ADMIN_DRIVER_PROFILE_WRITES_ENABLED=oldFlag;});
    let calls=0;const app=express();app.use(express.json());app.use('/admin',createAdminRouter({async getConnection(){calls++;return {release(){},async query(sql){assert.match(sql,/SELECT emp_id, account_type, is_active/);return [[{emp_id:7,account_type:'superadmin',is_active:1,is_deleted:0}]];}};}}));const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await once(server,'listening');const token=jwt.sign({employeeId:7,auth_type:'staff',role:'admin'},process.env.JWT_SECRET);const base=`http://127.0.0.1:${server.address().port}`;
    for(const [method,url] of [['PATCH','/admin/drivers/10/profile'],['POST','/admin/drivers/10/documents/photo']]){const response=await fetch(base+url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,423);assert.equal((await response.json()).code,'DRIVER_WRITES_DISABLED');}
    const denied=await fetch(base+'/admin/drivers/10/profile');assert.equal(denied.status,401);assert.equal(calls,2);
});
