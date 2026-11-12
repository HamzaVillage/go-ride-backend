const test=require('node:test');const assert=require('node:assert/strict');
const {createCityToCityDispatch}=require('../services/cityToCityDispatch');
function fixture({service='shared',capacity=4,weight=20,city=1,active=false,approved=true,enabled=true,fresh=true,requestFresh=true}={}){
 const state={queries:[],assigned:null,commits:0,rollbacks:0};let unlock;let queue=Promise.resolve();
 const request={id:9,customer_user_id:55,service_id:1,service_type:service,origin_city_id:1,destination_city_id:2,pickup_address:'Karachi pickup',dropoff_address:'Hyderabad drop',passenger_count:service==='parcel'?null:3,weight_kg:service==='parcel'?10:null,status:'open',request_is_fresh:requestFresh?1:0,expires_at:new Date(Date.now()+3600000),requested_departure_at:new Date(),customer_offer_amount:'3000',currency:'PKR',fare_snapshot:JSON.stringify({commission_percent:10})};
 async function query(sql,args=[]){state.queries.push({sql,args});
  if(sql.includes('FROM sysconfigsetup'))return [[{city_to_city_service:enabled?1:0}]];
  if(sql.startsWith('SELECT *, (presence_updated_at'))return [[{id:args[0],user_id:args[0],application_status:approved?'approved':'pending',is_online:1,current_city_id:city,presence_updated_at:new Date(Date.now()-5*3600000),presence_is_fresh:fresh?1:0}]];
  if(sql.includes('FROM ride_history'))return [active?[{Ride_ID_Pk:1}]:[]];
  if(sql.startsWith('SELECT id FROM city_to_city_trips'))return [[]];
  if(sql.startsWith('SELECT b.id'))return [[]];
  if(sql.startsWith('SELECT r.*,p.weight_kg'))return [[{...request,status:state.assigned?'booked':'open'}]];
  if(sql.startsWith('SELECT ds.id'))return [[{id:1}]];
  if(sql.startsWith('SELECT * FROM city_to_city_vehicles'))return [(service==='parcel'?weight>=10:capacity>=3)?[{id:80,passenger_capacity:capacity,max_parcel_weight_kg:weight}]:[]];
  if(sql.startsWith('INSERT INTO city_to_city_trips'))return [{insertId:200}];
  if(sql.startsWith('INSERT INTO city_to_city_bookings'))return [{insertId:201}];
  if(sql.startsWith('INSERT INTO city_to_city_dispatch')){state.assigned=args[1];return [{}];}
  if(sql.startsWith('SELECT r.id,r.service_type'))return [[{id:9}]];
  if(sql.startsWith('SELECT id FROM city_to_city_requests WHERE customer_user_id=? AND idempotency_key'))return [[]];
  if(sql.startsWith('SELECT * FROM city_to_city_services'))return [[{id:1,code:service,max_passengers:30,max_parcel_weight_kg:100,pricing_unit:service==='shared'?'per_seat':service==='private'?'whole_car':'per_delivery',currency:'PKR',is_pricing_enabled:1,base_fare:100,per_km_rate:10,rounding_increment:10,allows_now:1,allows_scheduled:1}]];
  if(sql.includes('FROM city_to_city_fare_rates'))return [[]];
  if(sql.startsWith('SELECT r.*,o.City_Name'))return [[]];
  return [[]];
 }
 const pool={query,getConnection:async()=>{let release;return {async beginTransaction(){const previous=queue;queue=new Promise(r=>{release=r});await previous;},query,async commit(){state.commits++;release?.();},async rollback(){state.rollbacks++;release?.();},release(){}};}};
 const geo={city:async point=>({id:point.latitude>25?2:1,name:point.latitude>25?'Hyderabad':'Karachi'}),route:async()=>({km:100,minutes:120})};
 return {service:createCityToCityDispatch(pool,geo),state,request,geo};
}
test('first driver wins atomically, concurrent second acceptance fails without another trip',async()=>{
 const f=fixture();const results=await Promise.allSettled([f.service.accept(10,9),f.service.accept(11,9)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
 assert.equal(f.state.queries.filter(q=>q.sql.startsWith('INSERT INTO city_to_city_trips')).length,1);
 assert.equal(f.state.queries.filter(q=>q.sql.startsWith('INSERT INTO city_to_city_bookings')).length,1);
 assert.match(f.state.queries.find(q=>q.sql.startsWith('SELECT r.*,p')).sql,/FOR UPDATE/);
 const booking=f.state.queries.find(q=>q.sql.startsWith('INSERT INTO city_to_city_bookings'));assert.equal(booking.args[6],300);assert.equal(booking.args[7],2700);
});
test('city mismatch, insufficient capacity, pending approval, disabled service and existing city ride block acceptance',async()=>{
 for(const setup of [{city:2},{capacity:2},{service:'parcel',weight:5},{approved:false},{enabled:false},{active:true}]){
  const f=fixture(setup);await assert.rejects(f.service.accept(10,9));assert.equal(f.state.queries.some(q=>q.sql.startsWith('INSERT')),false);
 }
});
test('feed filters by current origin city, approved services and vehicle capacity without any distance radius',async()=>{
 const f=fixture();await f.service.requests(10);const q=f.state.queries.find(q=>q.sql.startsWith('SELECT r.id,r.service_type'));assert.equal(q.args[1],1);
 assert.match(q.sql,/r.origin_city_id=\?/);assert.match(q.sql,/passenger_capacity>=r.passenger_count/);assert.match(q.sql,/max_parcel_weight_kg>=p.weight_kg/);assert.doesNotMatch(q.sql,/ST_DISTANCE|ACOS|HAVERSINE|radius|home_city/i);
});
test('all three services share dispatch; parcel trips reserve kg rather than passenger seats',async()=>{
 for(const service of ['shared','private','parcel']){
  const f=fixture({service});await f.service.accept(10,9);const args=f.state.queries.find(q=>q.sql.startsWith('INSERT INTO city_to_city_trips')).args;
  assert.equal(args[3],service);assert.equal(args[7],service==='parcel'?0:4);assert.equal(args[8],service==='parcel'?20:null);
 }
});
test('server quote derives city/route and calculates shared total per seat from master tariff',async()=>{
 const f=fixture();const q=await f.service.quote(55,{pickup:{latitude:24,longitude:67},dropoff:{latitude:26,longitude:68},service_type:'shared',passenger_count:3});assert.equal(q.suggested_fare,3300);assert.equal(q.origin.id,1);assert.equal(q.destination.id,2);
 await assert.rejects(f.service.quote(55,{pickup:{latitude:24,longitude:67},dropoff:{latitude:24.8,longitude:67},service_type:'shared',passenger_count:3}),{status:400});
});
test('online presence uses server-resolved current city rather than caller city ID',async()=>{
 const f=fixture();const r=await f.service.presence(10,{latitude:26,longitude:68,city_id:999,online:true});assert.equal(r.city.id,2);
 assert.deepEqual(f.state.queries.find(q=>q.sql.startsWith('UPDATE city_to_city_drivers SET is_online=1')).args,[2,10]);
});
test('request status is scoped to the authenticated customer',async()=>{
 const f=fixture();await assert.rejects(f.service.status(99,9),{status:404});const q=f.state.queries.find(q=>q.sql.startsWith('SELECT r.*,o.City_Name'));assert.deepEqual(q.args,[9,99]);
});

test('request creation snapshots the fare and parcel details, and retries return the same request',async()=>{
 const f=fixture({service:'parcel'});const rows=[];const inserts=[];
 const pool={async query(sql,args){
   if(sql.includes('FROM city_to_city_requests WHERE customer_user_id=? AND idempotency_key'))return [rows.length?[{id:44}]:[]];
   if(sql.includes('FROM sysconfigsetup'))return [[{city_to_city_service:1}]];
   if(sql.includes('FROM city_to_city_services'))return [[{id:1,code:'parcel',pricing_unit:'per_delivery',currency:'PKR',is_pricing_enabled:0,allows_now:1,allows_scheduled:1}]];
   if(sql.includes('FROM city_to_city_fare_rates'))return [[]];throw new Error(sql);
 },async getConnection(){return {async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args){
   if(sql.startsWith('SELECT User_ID_Pk'))return [[{User_ID_Pk:55,User_Name:'Sender',Mobile:'03001234567'}]];
   if(sql.startsWith('SELECT'))return [[]];
   inserts.push({sql,args});if(sql.startsWith('INSERT INTO city_to_city_requests')){rows.push(44);return [{insertId:44}];}return [{}];
 }};}};
 const service=createCityToCityDispatch(pool,f.geo);const body={idempotency_key:'c2c-test-key-12345678',service_type:'parcel',pickup:{latitude:24,longitude:67,address:'Karachi'},dropoff:{latitude:26,longitude:68,address:'Hyderabad'},parcel_weight_kg:10,parcel_description:'Books',recipient_name:'Recipient',recipient_phone:'03007654321',offer_amount:2500};
 assert.deepEqual(await service.create(55,body),{id:44});assert.deepEqual(await service.create(55,body),{id:44});
 assert.equal(inserts.filter(q=>q.sql.startsWith('INSERT INTO city_to_city_requests')).length,1);
 const parcel=inserts.find(q=>q.sql.startsWith('INSERT INTO city_to_city_parcel_details'));assert.deepEqual(parcel.args,[44,'Sender','03001234567','Recipient','03007654321','Books',10]);
 for(const q of inserts)assert.equal((q.sql.match(/\?/g)||[]).length,q.args.length);
});

test('catalog quotes all three services from one server-resolved route and rejects same-city',async()=>{
 const f=fixture();let cities=0,routes=0;
 const geo={city:async p=>{cities++;return f.geo.city(p);},route:async()=>{routes++;return {km:100,minutes:120};}};
 const pool={async query(sql,args){
  if(sql.includes('FROM sysconfigsetup'))return [[{city_to_city_service:1}]];
  if(sql.startsWith('SELECT code,name'))return [['private','shared','parcel'].map(code=>({code,name:code}))];
  if(sql.startsWith('SELECT * FROM city_to_city_services'))return [[{id:1,code:args[0],is_pricing_enabled:1,per_km_rate:args[0]==='private'?50:20,currency:'PKR'}]];
  if(sql.includes('city_to_city_fare_rates'))return [[]];
  throw new Error(sql);
 }};
 const service=createCityToCityDispatch(pool,geo);
 const result=await service.quotes(55,{pickup:{latitude:24,longitude:67},dropoff:{latitude:26,longitude:68}});
 assert.equal(cities,2);assert.equal(routes,1);
 assert.deepEqual(result.quotes.map(q=>q.suggested_fare),[5000,2000,2000]);
 assert.equal(result.quotes[2].preview_weight_kg,1);assert.equal(result.quotes[2].preview_passengers,null);
 await assert.rejects(service.quotes(55,{pickup:{latitude:24,longitude:67},dropoff:{latitude:24.8,longitude:67}}),{status:400});
});

test('driver freshness is checked using database clock despite mysql timezone decoding',async()=>{
 const f=fixture();await f.service.requests(10);const q=f.state.queries.find(q=>q.sql.includes('AS presence_is_fresh'));
 assert.match(q.sql,/presence_updated_at>DATE_SUB\(UTC_TIMESTAMP\(\),INTERVAL 90 SECOND\)/);
 // The fixture deliberately supplies a decoded date five hours old with SQL freshness=true.
 assert.ok(f.state.queries.some(q=>q.sql.startsWith('SELECT r.id,r.service_type')));
});
test('new request dates are bound as UTC SQL strings rather than timezone-shifted Date objects',async()=>{
 const queries=[];const f=fixture();
 const pool={query:async(sql,args)=>{
  if(sql.includes('idempotency_key'))return [[]];
  if(sql.includes('sysconfigsetup'))return [[{city_to_city_service:1}]];
  if(sql.includes('city_to_city_services'))return [[{id:1,code:'shared',currency:'PKR',is_pricing_enabled:0,allows_scheduled:1}]];
  return [[]];
 },getConnection:async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
  queries.push({sql,args});if(sql.startsWith('SELECT User_ID_Pk'))return [[{User_ID_Pk:55}]];
  if(sql.startsWith('INSERT INTO city_to_city_requests'))return [{insertId:44}];return [[]];
 }})};
 const departure=new Date(Date.now()+3600000).toISOString();
 await createCityToCityDispatch(pool,f.geo).create(55,{idempotency_key:'utc-time-test-key-123',service_type:'shared',pickup:{latitude:24,longitude:67,address:'Karachi'},dropoff:{latitude:26,longitude:68,address:'Hyderabad'},passenger_count:1,departure_at:departure,offer_amount:2000});
 const q=queries.find(q=>q.sql.startsWith('INSERT INTO city_to_city_requests'));
 assert.equal(q.args[12],departure.slice(0,23).replace('T',' '));assert.equal(q.args[21],q.args[12]);
});

test('stale driver presence and expired requests are rejected using SQL freshness flags',async()=>{
 const stale=fixture({fresh:false});assert.deepEqual(await stale.service.requests(10),{requests:[],online:false});
 await assert.rejects(stale.service.accept(10,9),{status:409});
 const expired=fixture({requestFresh:false});await assert.rejects(expired.service.accept(10,9),{status:409});
 assert.equal(expired.state.queries.some(q=>q.sql.startsWith('INSERT')),false);
});
