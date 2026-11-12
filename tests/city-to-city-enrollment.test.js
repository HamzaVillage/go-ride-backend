const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveCityToCityIdentity}=require('../services/cityToCityIdentity');
const {createCityToCityDrivers}=require('../services/cityToCityDrivers');
test('legacy driver session resolves only through the verified token phone; deleted/privileged identities fail',async()=>{
    const identityPool=rows=>({getConnection:async()=>({release(){},query:async sql=>[sql.includes('WHERE User_ID_Pk=')?[]:rows]})});
    const owner={User_ID_Pk:7,Mobile:'03001234567',Role:'rider',AccountDeleted:0};
    const resolved=await resolveCityToCityIdentity(identityPool([owner]),{userId:25,phone:'0300-1234567',role:'driver'});
    assert.equal(resolved.userId,7);
    await assert.rejects(resolveCityToCityIdentity(identityPool([]),{userId:25,phone:'03001234567',role:'driver'}),{status:401});
    await assert.rejects(resolveCityToCityIdentity(identityPool([owner,owner]),{userId:25,phone:'03001234567',role:'driver'}),{status:401});
    await assert.rejects(resolveCityToCityIdentity(identityPool([{...owner,AccountDeleted:1}]),{phone:'03001234567',role:'driver'}),{status:403});
    await assert.rejects(resolveCityToCityIdentity(identityPool([owner]),{phone:'03001234567',role:'admin'}),{status:403});
});
function fixture(vehicleType='Car'){
    const state={queries:[],exists:false,commits:0,rollbacks:0};
    const source={id:25,full_name:'Ali',cnic:'4210112345671',city:'Karachi',vehicle_type:vehicleType,vehicle_model:'Corolla',vehicle_number:'ABC-123',photo_path:'https://example.test/photo.jpg',cnic_front_path:'uploads/front.jpg',cnic_back_path:'uploads/back.jpg',license_path:'admin-private:license.jpg',vehicle_doc_path:'uploads/registration.jpg'};
    const conn={beginTransaction:async()=>{},commit:async()=>{state.commits++},rollback:async()=>{state.rollbacks++},release(){},query:async(sql,args)=>{
        state.queries.push({sql,args});
        if(sql.includes('FROM users WHERE'))return [[{User_ID_Pk:7,Mobile:'03001234567',User_Name:'Ali',Role:'rider',AccountDeleted:0}]];
        if(sql.includes('FROM drivers WHERE'))return [[source]];
        if(sql.includes('SELECT id,application_status FROM city_to_city_drivers'))return [state.exists?[{id:19,application_status:'pending'}]:[]];
        if(sql.includes('FROM city WHERE'))return [[]]; // unknown legacy city must not prevent pending enrollment
        if(sql.includes('FROM city_to_city_services'))return [[{id:1,code:'shared'}]];
        if(sql.startsWith('INSERT INTO city_to_city_drivers')){state.exists=true;return [{insertId:19}];}
        if(sql.includes('FROM city_to_city_drivers d LEFT JOIN'))return [[{id:19,user_id:7,source_driver_id:25,enrollment_source:'city_driver',application_status:'pending'}]];
        if(sql.startsWith('INSERT INTO city_to_city_vehicles'))return [{insertId:41}];
        if(sql.startsWith('SELECT'))return [[]];
        return [{}];
    }};
    return {state,source,service:createCityToCityDrivers({getConnection:async()=>conn})};
}
test('existing-driver enrollment creates one pending profile and references documents without modifying city driver or requiring new uploads',async()=>{
    const f=fixture();
    const first=await f.service.enrollExisting(7,{Passenger_Capacity:4,Max_Parcel_Weight_Kg:20});
    assert.equal(first.profile.application_status,'pending');assert.equal(first.profile.source_driver_id,25);
    const second=await f.service.enrollExisting(7,{Passenger_Capacity:4,Max_Parcel_Weight_Kg:20});assert.equal(second.already_submitted,true);
    assert.equal(f.state.queries.filter(q=>q.sql.startsWith('INSERT INTO city_to_city_drivers')).length,1);
    const documents=f.state.queries.filter(q=>q.sql.startsWith('INSERT INTO city_to_city_driver_documents'));
    assert.equal(documents.length,5);
    assert.ok(documents.some(q=>q.args.includes('uploads/front.jpg')&&q.args.includes('cnic_front_path')));
    assert.equal(f.state.queries.some(q=>/^(INSERT INTO|UPDATE|DELETE FROM) (drivers|users)\b/.test(q.sql)),false);
    assert.equal(f.state.queries.some(q=>q.sql.startsWith('INSERT INTO city_to_city_vehicles')),true);
    const vehicle=f.state.queries.find(q=>q.sql.startsWith('INSERT INTO city_to_city_vehicles'));
    assert.deepEqual(vehicle.args,[19,'Car','Corolla','ABC-123',null,4,20]);
    assert.ok(f.state.queries.some(q=>q.sql.startsWith('UPDATE city_to_city_driver_documents SET vehicle_id')&&q.args[0]===41));
    const inserted=f.state.queries.find(q=>q.sql.startsWith('INSERT INTO city_to_city_drivers'));
    assert.equal(inserted.args[2],null);assert.match(inserted.sql,/'pending',0/);
    const services=f.state.queries.find(q=>q.sql.startsWith('INSERT INTO city_to_city_driver_services'));
    assert.match(services.sql,/'pending',0/);
});

test('existing driver must supply valid seats and kg before any enrollment writes', async()=>{
  const f=fixture();
  for(const body of [{},{Passenger_Capacity:0,Max_Parcel_Weight_Kg:20},{Passenger_Capacity:4,Max_Parcel_Weight_Kg:0},{Passenger_Capacity:4,Max_Parcel_Weight_Kg:'heavy'}]) await assert.rejects(f.service.enrollExisting(7,body),{status:400});
  assert.equal(f.state.queries.length,0);
});

test('capacity completion is owner-scoped, blocks active trips and resets approval without city-driver writes',async()=>{
 const calls=[];let active=false;
 const conn={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},async query(sql,args){calls.push({sql,args});
  if(sql.includes('FROM users WHERE'))return [[{User_ID_Pk:7,Role:'rider',AccountDeleted:0}]];
  if(sql.startsWith('SELECT id,application_status,source_snapshot'))return [[{id:19,application_status:'approved'}]];
  if(sql.includes('FROM city_to_city_trips'))return [active?[{id:88}]:[]];
  if(sql.startsWith('SELECT id FROM city_to_city_vehicles'))return [[{id:41}]];
  if(sql.includes('FROM city_to_city_drivers d LEFT JOIN'))return [[{id:19,application_status:'pending'}]];
  return [[]];
 }};
 const service=createCityToCityDrivers({getConnection:async()=>conn});
 await service.updateCapacity(7,{Passenger_Capacity:5,Max_Parcel_Weight_Kg:25});
 assert.ok(calls.some(q=>q.sql.includes("application_status='pending',is_online=0")));
 assert.deepEqual(calls.find(q=>q.sql.startsWith('SELECT id,application_status,source_snapshot')).args,[7]);
 assert.ok(calls.some(q=>q.sql.startsWith('UPDATE city_to_city_vehicles')&&q.args[0]===5&&q.args[1]===25));
 assert.equal(calls.some(q=>/^(UPDATE|INSERT INTO) (drivers|users)\b/.test(q.sql)),false);
 active=true;calls.length=0;
 await assert.rejects(service.updateCapacity(7,{Passenger_Capacity:5,Max_Parcel_Weight_Kg:25}),{status:409});
 assert.equal(calls.some(q=>q.sql.startsWith('UPDATE')),false);
});


test('bike owner uploads a separate car registration while personal document references are reused',async()=>{
 const f=fixture('Bike');
 const body={Passenger_Capacity:4,Max_Parcel_Weight_Kg:20,New_Vehicle:'1',Vehicle_Type:'Sedan',Vehicle_Model:'Civic',Vehicle_Number:'CAR-123',Vehicle_Color:'White'};
 const result=await f.service.enrollExisting(7,body,{Vehicle_Running_Page:[{storedPath:'admin-private:new-car.jpg'}]});
 assert.equal(result.profile.application_status,'pending');assert.equal(f.source.vehicle_type,'Bike');
 const vehicle=f.state.queries.find(q=>q.sql.startsWith('INSERT INTO city_to_city_vehicles'));
 assert.deepEqual(vehicle.args,[19,'Sedan','Civic','CAR-123','White',4,20]);
 const documents=f.state.queries.filter(q=>q.sql.startsWith('INSERT INTO city_to_city_driver_documents'));
 assert.equal(documents.length,5);assert.ok(documents.some(q=>q.args.includes('uploads/front.jpg')));
 assert.ok(documents.some(q=>q.args.includes('admin-private:new-car.jpg')&&q.args.includes(41)));
 assert.equal(documents.some(q=>q.args.includes('uploads/registration.jpg')),false);
 assert.equal(f.state.queries.some(q=>/^(UPDATE|INSERT INTO|DELETE FROM) (drivers|users)\b/.test(q.sql)),false);
 assert.equal(f.state.queries.some(q=>q.sql.startsWith('UPDATE city_to_city_driver_documents SET vehicle_id')),false);
});
test('new city-to-city vehicle requires its own registration file and rejects bike/rickshaw types',async()=>{
 for(const type of ['Car','Bike','Auto','Rickshaw']){
   const f=fixture('Bike');
   await assert.rejects(f.service.enrollExisting(7,{Passenger_Capacity:4,Max_Parcel_Weight_Kg:20,New_Vehicle:'1',Vehicle_Type:type,Vehicle_Model:'Civic',Vehicle_Number:'CAR-123',Vehicle_Color:'White'}),{status:400});
   assert.equal(f.state.queries.length,0);
 }
});

test('separate personal document uploads are saved to city-to-city only and remain pending',async()=>{
 const f=fixture();
 await f.service.enrollExisting(7,{Passenger_Capacity:4,Max_Parcel_Weight_Kg:20},{Photo:[{storedPath:'uploads/new-photo.jpg'}],CNIC_Front:[{storedPath:'admin-private:new-front.jpg'}],CNIC_Back:[{storedPath:'admin-private:new-back.jpg'}],License:[{storedPath:'admin-private:new-license.jpg'}]});
 for(const file of ['uploads/new-photo.jpg','admin-private:new-front.jpg','admin-private:new-back.jpg','admin-private:new-license.jpg']){
  const insert=f.state.queries.find(q=>q.sql.startsWith('INSERT INTO city_to_city_driver_documents')&&q.args.includes(file));
  assert.ok(insert);assert.match(insert.sql,/'pending'/);
 }
 assert.equal(f.state.queries.some(q=>/^(UPDATE|INSERT INTO) (drivers|users)\b/.test(q.sql)),false);
});
