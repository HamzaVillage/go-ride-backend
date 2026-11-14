const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAdminDriverRegistration, validateRequest } = require('../services/adminDriverRegistration');
const normal = () => ({ idempotency_key:crypto.randomUUID(),profile:{ full_name:'Ali',phone:'+923001234567',city:'Karachi',address:'Test address',cnic:'42101-1234567-1',vehicle_type:'Car',vehicle_model:'Corolla',vehicle_number:'ABC-123' } });
const city = () => ({ idempotency_key:crypto.randomUUID(),profile:{ full_name:'Ali',phone:'03001234567',city:'Karachi',address:'Test address' },application:{ Name:'Ali',FatherName:'Ahmed',Cnic:'42101-1234567-1',DOB:'1995-02-20',Address:'Test address',Home_City_ID:'1',Vehicle_Type:'Sedan',Vehicle_Model:'Corolla',Vehicle_Number:'ABC-123',Vehicle_Color:'White',Passenger_Capacity:'4',Services:'["private"]' } });
function fixture({ owner=null, duplicate=false, denied=false, failure=false, lostCommit=false, lockFailure=false } = {}) {
 const state={ calls:[], commits:0, rollbacks:0, released:0, request:null, user:owner, cityDriver:null };
 const conn={
  async beginTransaction(){}, async commit(){if(lostCommit)throw new Error('Lost commit acknowledgement');state.commits++;}, async rollback(){state.rollbacks++;},release(){state.released++;},
  async query(sql,args=[]){
   state.calls.push({sql,args});
   if(sql.includes('GET_LOCK'))return [[{acquired:lockFailure?0:1}]];
   if(sql.includes('RELEASE_LOCK'))return [[{}]];
   if(sql.includes('FROM employee WHERE'))return [[{emp_id:7,account_type:'employee',is_active:1,is_deleted:0}]];
   if(sql.includes('SELECT DISTINCT'))return [denied?[]:[{function_code:'drivers'},{function_code:'city_to_city_drivers'}]];
   if(sql.includes('FROM admin_driver_registration_requests'))return [state.request?[state.request]:[]];
   if(sql.includes('FROM users WHERE Email'))return [[]];
   if(sql.includes('FROM users WHERE'))return [state.user?[state.user]:[]];
   if(sql.includes('FROM drivers WHERE'))return [duplicate?[{id:4}]:[]];
   if(sql.includes('SELECT id FROM city_to_city_drivers'))return [duplicate?[{id:4}]:[]];
   if(sql.includes('SELECT id, application_status FROM city_to_city_drivers'))return [[]];
   if(sql.includes('FROM city_to_city_drivers d LEFT'))return [[state.cityDriver]];
   if(sql.includes('FROM vehicle_fare_rate'))return [[{Vehicle_Type:'Car'}]];
   if(sql.includes('FROM city WHERE'))return [[{ID_PK:1}]];
   if(sql.includes('FROM city_to_city_services WHERE'))return [[{id:1,code:'private'}]];
   if(sql.startsWith('INSERT INTO users')){ state.user={User_ID_Pk:21,User_Name:'Ali',Mobile:'03001234567',Role:'rider',AccountDeleted:0}; return [{insertId:21}]; }
   if(sql.startsWith('INSERT INTO drivers')){ if(failure)throw new Error('driver insert failed');return [{insertId:31}]; }
   if(sql.startsWith('INSERT INTO city_to_city_drivers')){state.cityDriver={id:41,user_id:21,application_status:'pending'};return [{insertId:41}];}
   if(sql.startsWith('INSERT INTO city_to_city_vehicles')){if(failure)throw new Error('vehicle insert failed');return [{insertId:51}];}
   if(sql.startsWith('INSERT INTO admin_driver_registration_requests')){state.request={request_key:args[0],actor_id:args[1],fingerprint:args[2],driver_kind:args[3],driver_id:args[4],user_id:args[5]};return [{}];}
   if(sql.startsWith('SELECT'))return [[]];
   return [{}];
  },
 };
 return { state,service:createAdminDriverRegistration({getConnection:async()=>conn},{saveDocument:async(file,type)=>({storedPath:type==='photo'?'https://fixture.test/uploads/photo.png':'admin-private:cnic.png',filePath:'/nonexistent/fixture-file'})}) };
}
for(const kind of ['normal','city_to_city']){
 test(`${kind}: creates a rider and pending driver atomically without franchise`,async()=>{
  const f=fixture(),body=kind==='normal'?normal():city();
  const result=await f.service.create(7,kind,body,{Photo:[{buffer:Buffer.from('fixture')}],CNIC_Front:[{buffer:Buffer.from('fixture')}]});
  assert.equal(result.user_id,21);assert.equal(result.status,'pending');assert.equal(f.state.commits,1);assert.equal(f.state.released,1);
  const u=f.state.calls.find(q=>q.sql.startsWith('INSERT INTO users'));assert.match(u.sql,/'rider'/);assert.match(u.sql,/NULL/);assert.equal(u.args[1],'03001234567');
  const d=f.state.calls.find(q=>q.sql.startsWith(`INSERT INTO ${kind==='normal'?'drivers':'city_to_city_drivers'} `));assert.equal(d.args[0],21);assert.match(d.sql,/'pending'/);
  if(kind==='normal'){assert.match(d.sql,/Franchiser_ID_FK/);assert.ok(d.args.includes('admin-private:cnic.png'));}
  else{assert.equal(f.state.calls.some(q=>q.sql.startsWith('INSERT INTO drivers ')),false);assert.ok(f.state.calls.some(q=>q.sql.startsWith('INSERT INTO city_to_city_driver_documents')&&q.args.includes('admin-private:cnic.png')));}
 });
 test(`${kind}: links an existing rider without creating or reassigning it`,async()=>{
  const f=fixture({owner:{User_ID_Pk:21,Role:'rider',AccountDeleted:0,Mobile:'03001234567'}});
  assert.equal((await f.service.create(7,kind,kind==='normal'?normal():city())).user_id,21);
  assert.equal(f.state.calls.some(q=>q.sql.startsWith('INSERT INTO users')||q.sql.startsWith('UPDATE users')),false);
 });
 test(`${kind}: failure rolls back the linked rider and releases phone lock`,async()=>{
  const f=fixture({failure:true});await assert.rejects(f.service.create(7,kind,kind==='normal'?normal():city()),/insert failed/);
  assert.equal(f.state.commits,0);assert.equal(f.state.rollbacks,1);assert.ok(f.state.calls.some(q=>q.sql.includes('RELEASE_LOCK')));assert.equal(f.state.released,1);
 });
 test(`${kind}: retries recover the same linked records without duplicate writes`,async()=>{
  const f=fixture(),body=kind==='normal'?normal():city();const first=await f.service.create(7,kind,body);const count=f.state.calls.filter(q=>q.sql.startsWith('INSERT')).length;
  const second=await f.service.create(7,kind,body);assert.equal(second.replayed,true);assert.equal(second.id,first.id);assert.equal(second.user_id,21);assert.equal(f.state.calls.filter(q=>q.sql.startsWith('INSERT')).length,count);
  await assert.rejects(f.service.create(8,kind,body),{status:409});
 });
}
test('rejects staff, deleted, franchise-linked or duplicate accounts before inserting',async()=>{
 for(const config of [{owner:{User_ID_Pk:1,Role:'admin'}},{owner:{User_ID_Pk:1,Role:'rider',AccountDeleted:1}},{owner:{User_ID_Pk:1,Role:'rider',Franchiser_ID_FK:5}},{duplicate:true},{denied:true},{lockFailure:true}]){
  const f=fixture(config);await assert.rejects(f.service.create(7,'normal',normal()));assert.equal(f.state.calls.some(q=>q.sql.startsWith('INSERT')),false);
 }
});
test('client cannot inject franchise, actor, role or approved status',()=>{
 for(const changes of [{franchise_id:5},{actor_id:9},{profile:{...normal().profile,Role:'admin'}},{profile:{...normal().profile,status:'active'}}])assert.throws(()=>validateRequest('normal',{...normal(),...changes}),{status:400});
 assert.throws(()=>validateRequest('city_to_city',{...city(),application:{...city().application,Vehicle_Type:'Bike'}}),{status:400});
});
test('lost commit response rolls back locally and retains the retry key',async()=>{
 const f=fixture({lostCommit:true}),body=normal();await assert.rejects(f.service.create(7,'normal',body),/Lost commit/);assert.equal(f.state.request.request_key,body.idempotency_key);assert.equal(f.state.released,1);
});
