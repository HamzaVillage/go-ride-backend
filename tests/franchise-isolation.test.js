const test=require('node:test');
const assert=require('node:assert/strict');
const {getAccess,requirePermission,requireFranchiseResource,createAccessMiddleware}=require('../services/employeeAccess');
const {createAdminFranchisesService}=require('../services/adminFranchises');
const {createAdminDriversService}=require('../services/adminDrivers');
const {createAdminDirectoriesService}=require('../services/adminDirectories');
const {createAdminOverviewService}=require('../services/adminOverview');
const {createEmployeeService}=require('../services/adminEmployees');
const grants=['01','02','03','04','05','09','10','11','12','16'].map(function_code=>({function_code,can_view:1,can_add:1,can_edit:1,can_delete:1}));
function fixture({root=false,franchiseId=7,status='active',respond}={}){
 const calls=[];let commits=0,rollbacks=0;
 const conn={release(){},beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.includes('FROM employee WHERE emp_id = ?') && sql.includes('account_type'))return [[{emp_id:1,account_type:root?'superadmin':'employee',is_active:1,is_deleted:0,franchise_id:franchiseId}]];
  if(sql.includes('FROM assign_role a') && sql.includes('function_code'))return [grants];
  if(sql.startsWith('SELECT id,company_name,city,status FROM franchiser WHERE'))return [[{id:7,company_name:'Karachi Central',city:'Karachi',status}]];
  if(respond){const result=respond(sql,params);if(result!==undefined)return [result];}
  throw new Error('Unexpected query: '+sql);
 }};
 return {conn,pool:{getConnection:async()=>conn},calls,get commits(){return commits;},get rollbacks(){return rollbacks;}};
}
test('assigned franchise constrains the same role, removes global administration and profile writes',async()=>{
 const f=fixture();const a=await getAccess(f.conn,1);
 assert.deepEqual(a.franchise,{id:7,name:'Karachi Central',city:'Karachi'});
 assert.deepEqual(a.functions,['overview','rides','drivers','riders','franchises','franchise_members']);
 for(const screen of ['settings','employees','offers','city_to_city_drivers'])assert.throws(()=>requirePermission(a,screen),{status:403});
 assert.throws(()=>requirePermission(a,'franchises','can_edit'),{status:403});
 assert.doesNotThrow(()=>requirePermission(a,'drivers','can_edit'));
});
test('global staff keep role-based access and super administrators are not franchise-limited',async()=>{
 const global=await getAccess(fixture({franchiseId:null}).conn,1);assert.equal(global.franchise,null);assert.ok(global.functions.includes('offers'));
 const root=await getAccess(fixture({root:true}).conn,1);assert.equal(root.is_super_admin,true);assert.ok(root.functions.includes('settings'));
});
test('inactive or removed assigned franchises fail closed rather than falling back to global access',async()=>{
 await assert.rejects(getAccess(fixture({status:'suspended'}).conn,1),{status:403});
 const f=fixture();f.conn.query=async sql=>sql.includes('FROM employee WHERE')?[[{emp_id:1,account_type:'employee',is_active:1,is_deleted:0,franchise_id:99}]]:sql.includes('FROM assign_role')?[grants]:[[]];
 await assert.rejects(getAccess(f.conn,1),{status:403});
});
test('foreign profile, wallet, document and franchise IDs are blocked before handlers run',async()=>{
 const f=fixture({respond:(sql,p)=>sql.startsWith('SELECT id FROM drivers WHERE') || sql.startsWith('SELECT User_ID_Pk FROM users WHERE') || sql.startsWith('SELECT id FROM franchiser WHERE') ? (Number(p[0])===7?[{id:7}]:[]) : undefined});
 for(const [kind,id] of [['drivers',99],['riders',99],['franchises',99]])await assert.rejects(requireFranchiseResource(f.conn,{franchise:{id:7}},kind,id),{status:404});
 for(const path of ['/ADMIN/drivers/99/wallet','/admin/drivers/99/wallet','/admin/drivers/99/documents/photo','/admin/riders/99','/admin/franchises/99']){
  let next=false,code,body;
  await createAccessMiddleware(f.pool,path.includes('/riders/')?'riders':path.includes('/franchises/')?'franchises':'drivers')({user:{employeeId:1},method:'GET',originalUrl:path},{status(n){code=n;return this;},json(v){body=v;}},()=>{next=true;});
  assert.equal(code,404,path);assert.equal(next,false);assert.equal(body.success,false);
 }
 await requireFranchiseResource(f.conn,{franchise:{id:7}},'drivers',7,true);
 assert.match(f.calls.at(-1).sql,/FOR UPDATE$/);
});
test('franchise staff cannot use standalone driver registration or global settings',async()=>{
 for(const [screen,path] of [['drivers','/admin/drivers'],['settings','/admin/settings']]){
  let code,next=false;
  await createAccessMiddleware(fixture().pool,screen)({user:{employeeId:1},method:'POST',originalUrl:path},{status(n){code=n;return this;},json(){}},()=>{next=true;});
  assert.equal(code,403);assert.equal(next,false);
 }
});
test('driver directory count, rows and city options are all franchise-scoped; request cannot select another franchise',async()=>{
 const f=fixture({respond:sql=>sql.startsWith('SELECT COUNT')?[{total:0}]:[]});
 const data=await createAdminDriversService(f.pool).list({franchise_id:99,city:'Karachi'},7);
 assert.equal(data.pagination.total,0);
 const queries=f.calls.filter(c=>c.sql.includes('FROM drivers'));
 assert.equal(queries.length,3);
 for(const q of queries){assert.match(q.sql,/d.Franchiser_ID_FK = \?/);assert.equal(q.params[0],7);assert.ok(!q.params.includes(99));}
});
test('franchise, ride and rider lists bind scope in both count and data queries',async()=>{
 const f=fixture({respond:sql=>sql.startsWith('SELECT COUNT')?[{total:0}]:[]});
 await createAdminFranchisesService(f.pool).list({},7);
 await createAdminDirectoriesService(f.pool).rides({},7);
 await createAdminDirectoriesService(f.pool).riders({},7);
 assert.equal(f.calls.length,6);
 for(const q of f.calls)assert.equal(q.params[0],7);
 assert.match(f.calls[0].sql,/f.id = \?/);
 assert.match(f.calls[2].sql,/d.Franchiser_ID_FK = \?/);
 assert.match(f.calls[4].sql,/u.Franchiser_ID_FK = \?/);
 assert.match(f.calls[5].sql,/rd.Franchiser_ID_FK=u.Franchiser_ID_FK/);
});
test('every dashboard dataset shares one franchise snapshot and separates fares, fees and driver earnings',async()=>{
 const f=fixture({respond:sql=>{
  if(sql.startsWith('SET ')||sql.startsWith('START '))return {};
  if(sql.includes('FROM users'))return [{total_users:3,total_riders:2}];
  if(sql.includes('FROM drivers') && sql.includes(' AS online'))return [{status:'active',count:2,online:1}];
  if(sql.includes(' AS city,'))return [{city:'Karachi',count:2}];
  if(sql.includes('FROM ride_history') && sql.includes(' AS status,'))return [{status:'completed',count:2,gross_fare:1000,platform_fees:100}];
  return [];
 }});
 const data=await createAdminOverviewService(f.pool).get({days:'7'},{id:7,name:'Karachi Central',city:'Karachi'});
 assert.equal(data.accounts.total_drivers,2);assert.equal(data.rides.total,2);
 assert.equal(data.rides.gross_fare,1000);assert.equal(data.rides.platform_fees,100);assert.equal(data.rides.driver_earnings,900);
 const reads=f.calls.filter(c=>c.sql.startsWith('SELECT'));
 assert.equal(reads.length,6);for(const q of reads){assert.match(q.sql,/Franchiser_ID_FK/);assert.equal(q.params.at(-1),7);}
 assert.equal(f.commits,1);assert.equal(data.daily.length,7);
});
const valid={company_name:'Central',city:'Karachi',contact_person:'Manager',phone:'03001234567',email:'manager@example.test',status:'active'};
test('only super admin creates franchise and city is mandatory; valid creation commits once',async()=>{
 const f=fixture({root:true,respond:sql=>sql.startsWith('INSERT INTO franchiser')?{insertId:8}:undefined});
 const svc=createAdminFranchisesService(f.pool);
 for(const invalid of [{...valid,city:''},{...valid,city:[]},{...valid,status:'deleted'},{...valid,email:'invalid'},{...valid,franchise_id:99}])await assert.rejects(svc.create(1,invalid),{status:400});
 assert.equal(f.calls.length,0);
 assert.deepEqual(await svc.create(1,valid),{id:8});assert.equal(f.commits,1);
 const insert=f.calls.find(c=>c.sql.startsWith('INSERT'));assert.ok(insert.params.includes('Pakistan'));assert.ok(insert.params.includes('Karachi'));
 await assert.rejects(createAdminFranchisesService(fixture().pool).create(1,valid),{status:403});
});
test('employee franchise assignment is atomic with profile and role changes and rejects non-super actors',async()=>{
 let saved=false;
 const f=fixture({root:true,respond:(sql,p)=>{
  if(sql.startsWith('SELECT * FROM employee WHERE'))return [{emp_id:2,account_type:'employee',version:1}];
  if(sql.startsWith("SELECT id FROM franchiser WHERE id=? AND status='active'"))return [{id:7}];
  if(sql.startsWith('UPDATE employee SET'))return {affectedRows:1};
  if(sql.startsWith('INSERT INTO employee_franchise_access')){assert.deepEqual(p,[2,7,1]);saved=true;return {affectedRows:1};}
  if(sql.includes('FROM employee WHERE emp_id = ?'))return [{emp_id:2,account_type:'employee',is_active:1,is_deleted:0,version:2,franchise_id:7}];
  if(sql.startsWith('SELECT a.role_id'))return [];
 }});
 await createEmployeeService(f.pool).saveEmployee(2,1,{version:1,franchise_id:7});assert.equal(saved,true);assert.equal(f.commits,1);
 const other=fixture();await assert.rejects(createEmployeeService(other.pool).saveEmployee(2,1,{version:1,franchise_id:7}),{status:403});assert.equal(other.rollbacks,1);
});
test('franchise setup dry run never accesses the database',async()=>{
 await require('../scripts/configureFranchises').configure({query(){throw new Error('Unexpected DB access');}});
});
test('profile and wallet writes recheck franchise ownership inside the transaction',async()=>{
 const f=fixture({respond:sql=>sql.startsWith('SELECT id FROM drivers WHERE')?[]:undefined});
 const {createAdminDriverProfiles}=require('../services/adminDriverProfiles');
 await assert.rejects(createAdminDriverProfiles(f.pool,{enabled:()=>true}).update(99,1,{version:'a'.repeat(64),changes:{full_name:'Changed'}}),{status:404});
 await assert.rejects(createAdminDriversService(f.pool).topup(99,1,{amount:'100',payment_method:'cash'},'01234567-89ab-4def-8123-0123456789ab'),{status:404});
 assert.equal(f.rollbacks,2);assert.equal(f.commits,0);
 assert.equal(f.calls.some(c=>c.sql.startsWith('UPDATE')||c.sql.startsWith('INSERT')),false);
});
test('invalid franchise assignment rolls back without saving an employee or changing scope',async()=>{
 const f=fixture({root:true,respond:sql=>{
  if(sql.startsWith('SELECT * FROM employee WHERE'))return [{emp_id:2,account_type:'employee',version:1}];
  if(sql.startsWith("SELECT id FROM franchiser WHERE id=? AND status='active'"))return [];
 }});
 await assert.rejects(createEmployeeService(f.pool).saveEmployee(2,1,{version:1,name:'New name',franchise_id:99}),{status:400});
 assert.equal(f.rollbacks,1);assert.equal(f.commits,0);assert.equal(f.calls.some(c=>c.sql.startsWith('UPDATE')||c.sql.startsWith('INSERT')),false);
});
