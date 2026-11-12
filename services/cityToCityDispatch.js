const {fail}=require('./cityToCityDrivers');
const {coordinate}=require('./cityToCityGeography');
const {calculateCityFare}=require('./cityToCityPricing');
const TYPES=['shared','private','parcel'];
const utcSQLDate=value=>new Date(value).toISOString().slice(0,23).replace('T',' ');
const activeSQL="('boarding','in_progress','planned')";
const safeText=(value,label,max=500)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw fail(400,`Enter ${label}.`);return value.trim();};
const id=value=>{if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail(400,'Invalid request.');return Number(value);};
function createCityToCityDispatch(pool,geo){
 async function transaction(action){const c=await pool.getConnection();try{await c.beginTransaction();const r=await action(c);await c.commit();return r;}catch(e){await c.rollback().catch(()=>{});throw e;}finally{c.release();}}
 async function enabled(c){const [rows]=await c.query('SELECT city_to_city_service FROM sysconfigsetup WHERE SCS_ID_Pk=1');if(Number(rows[0]?.city_to_city_service)!==1)throw fail(403,'City-to-city service is currently unavailable.');}
 async function driver(c,userId){const [r]=await c.query('SELECT *, (presence_updated_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 90 SECOND)) AS presence_is_fresh FROM city_to_city_drivers WHERE user_id=? FOR UPDATE',[userId]);if(r[0]?.application_status!=='approved')throw fail(403,'An approved city-to-city driver profile is required.');return r[0];}
 async function busy(c,userId,driverId){
  const [rides]=await c.query("SELECT r.Ride_ID_Pk FROM ride_history r LEFT JOIN drivers d ON d.id=r.Driver_ID_Fk WHERE (r.User_ID_Fk=? OR d.User_ID_FK=?) AND r.Ride_Status IN ('Requested','Accepted','Arrived','Started','Ongoing') LIMIT 1",[userId,userId]);
  const [trips]=await c.query(`SELECT id FROM city_to_city_trips WHERE city_to_city_driver_id=? AND status IN ${activeSQL} LIMIT 1`,[driverId]);
  const [bookings]=await c.query("SELECT b.id FROM city_to_city_bookings b JOIN city_to_city_requests r ON r.id=b.request_id WHERE r.customer_user_id=? AND b.status IN ('confirmed','picked_up') LIMIT 1",[userId]);
  if(rides.length||trips.length||bookings.length)throw fail(409,'Complete or cancel your active trip first.');
 }
 async function quote(userId,body,verifiedRoute){
  if(!TYPES.includes(body.service_type))throw fail(400,'Choose a valid service.');
  const pickup=coordinate(body.pickup),dropoff=coordinate(body.dropoff);
  const [origin,destination,route]=verifiedRoute || await Promise.all([geo.city(pickup),geo.city(dropoff),geo.route(pickup,dropoff)]);
  if(origin.id===destination.id)throw fail(400,'City-to-city pickup and destination must be in different cities.');
  await enabled(pool);
  const [s]=await pool.query('SELECT * FROM city_to_city_services WHERE code=? AND is_active=1',[body.service_type]);const service=s[0];if(!service)throw fail(400,'This service is unavailable.');
  const persons=body.service_type==='parcel'?null:Number(body.passenger_count);
  if(persons!==null&&(!Number.isInteger(persons)||persons<Number(service.min_passengers||1)||persons>Number(service.max_passengers||30)))throw fail(400,'Enter a valid number of passengers.');
  const weight=body.service_type==='parcel'?Number(body.parcel_weight_kg):null;
  if(weight!==null&&(!Number.isFinite(weight)||weight<=0||weight>Number(service.max_parcel_weight_kg||999999.99)))throw fail(400,'Enter a valid parcel weight.');
  let rate=service;
  const [rates]=await pool.query('SELECT * FROM city_to_city_fare_rates WHERE service_id=? AND origin_city_id=? AND destination_city_id=? AND vehicle_type IS NULL AND is_active=1 AND valid_from<=NOW() AND (valid_until IS NULL OR valid_until>NOW()) ORDER BY priority DESC,id DESC LIMIT 1',[service.id,origin.id,destination.id]);
  if(rates[0])rate={...service,...rates[0]};
  const suggested=calculateCityFare(rate,{distance_km:route.km,duration_minutes:route.minutes,passenger_count:persons,parcel_weight_kg:weight},body.service_type).suggested_fare;
  return {origin,destination,route,service,rate,persons,weight,suggested};
 }
 return {
  async quotes(userId,body){
   const pickup=coordinate(body.pickup),dropoff=coordinate(body.dropoff);
   const verified=await Promise.all([geo.city(pickup),geo.city(dropoff),geo.route(pickup,dropoff)]);
   if(verified[0].id===verified[1].id)throw fail(400,'City-to-city pickup and destination must be in different cities.');
   await enabled(pool);
   const [services]=await pool.query('SELECT code,name,min_passengers FROM city_to_city_services WHERE is_active=1 ORDER BY sort_order,id');
   const quotes=[];
   for(const service of services.filter(s=>TYPES.includes(s.code))){
    try{const q=await quote(userId,{pickup,dropoff,service_type:service.code,passenger_count:Number(service.min_passengers||1),parcel_weight_kg:1},verified);quotes.push({code:service.code,name:service.name,suggested_fare:q.suggested,currency:q.service.currency,pricing_unit:q.service.pricing_unit,preview_passengers:q.persons,preview_weight_kg:service.code==='parcel'?1:null});}
    catch(error){if(!error.status)throw error;quotes.push({code:service.code,name:service.name,suggested_fare:null,message:error.message});}
   }
   return {origin:verified[0],destination:verified[1],distance_km:verified[2].km,duration_minutes:verified[2].minutes,quotes};
  },
  async quote(userId,body){const q=await quote(userId,body);return {origin:q.origin,destination:q.destination,distance_km:q.route.km,duration_minutes:q.route.minutes,suggested_fare:q.suggested,currency:q.service.currency,pricing_unit:q.service.pricing_unit};},
  async create(userId,body){
   const key=safeText(body.idempotency_key,'request key',64);if(!/^[a-zA-Z0-9-]{16,64}$/.test(key))throw fail(400,'Invalid request key.');
   const [retry]=await pool.query('SELECT id FROM city_to_city_requests WHERE customer_user_id=? AND idempotency_key=?',[userId,key]);if(retry.length)return {id:retry[0].id};
   const q=await quote(userId,body);const amount=Number(body.offer_amount ?? q.suggested);
   if(!Number.isFinite(amount)||amount<=0||amount>99999999.99)throw fail(400,'Enter a valid total fare.');
   if(q.suggested!=null&&!Number(q.rate.allows_negotiation)&&Math.abs(amount-q.suggested)>0.01)throw fail(400,'Use the current recommended fare.');
   if(q.suggested!=null&&Number(q.rate.allows_negotiation) && (amount < q.suggested*(1-Number(q.rate.max_discount_percent||0)/100)-0.01 || amount > q.suggested*(1+Number(q.rate.max_markup_percent||0)/100)+0.01))throw fail(400,'Fare is outside the allowed negotiation range.');
   const when=body.departure_at?new Date(body.departure_at):new Date();if(!Number.isFinite(when.getTime())||when.getTime()<Date.now()-60000||when.getTime()>Date.now()+30*86400000)throw fail(400,'Choose a valid departure time.');
   if(!body.departure_at&&!Number(q.service.allows_now))throw fail(400,'Immediate trips are unavailable.');
   if(body.departure_at && when.getTime()<Date.now()+Number(q.service.minimum_notice_minutes||0)*60000)throw fail(400,'Choose a later departure time.');
   if(body.departure_at&&!Number(q.service.allows_scheduled))throw fail(400,'Scheduled trips are unavailable.');
   if(body.service_type==='parcel'&&!/^\+?[0-9 -]{7,25}$/.test(String(body.recipient_phone||'')))throw fail(400,'Enter a valid recipient phone number.');
   const pickupAddress=safeText(body.pickup.address,'pickup address'),dropoffAddress=safeText(body.dropoff.address,'destination address');
   return transaction(async c=>{
    const [owner]=await c.query('SELECT User_ID_Pk,User_Name,Mobile FROM users WHERE User_ID_Pk=? AND COALESCE(AccountDeleted,0)=0 FOR UPDATE',[userId]);if(!owner[0])throw fail(401,'Account unavailable.');
    const [driverRows]=await c.query('SELECT id FROM city_to_city_drivers WHERE user_id=?',[userId]);
    await busy(c,userId,driverRows[0]?.id || 0);
    const [old]=await c.query('SELECT id FROM city_to_city_requests WHERE customer_user_id=? AND idempotency_key=?',[userId,key]);if(old.length)return {id:old[0].id};
    const [open]=await c.query("SELECT id FROM city_to_city_requests WHERE customer_user_id=? AND status='open' AND expires_at>UTC_TIMESTAMP() LIMIT 1",[userId]);if(open.length)throw fail(409,'You already have a city-to-city request.');
    const [existing]=await c.query("SELECT b.id FROM city_to_city_bookings b JOIN city_to_city_requests r ON r.id=b.request_id WHERE r.customer_user_id=? AND b.status IN ('confirmed','picked_up') LIMIT 1",[userId]);if(existing.length)throw fail(409,'Complete your current city-to-city trip first.');
    const snapshot=JSON.stringify({service_id:q.service.id,rate_id:q.rate===q.service?null:q.rate.id,total:amount,suggested:q.suggested,currency:q.service.currency,commission_percent:Number(q.rate.commission_percent||0),commission_fixed:Number(q.rate.commission_fixed||0),distance_km:q.route.km});
    const [r]=await c.query("INSERT INTO city_to_city_requests (customer_user_id,service_id,service_type,origin_city_id,destination_city_id,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,departure_mode,requested_departure_at,passenger_count,estimated_distance_km,estimated_duration_minutes,fare_snapshot,suggested_fare,customer_offer_amount,pricing_unit,currency,status,expires_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',DATE_ADD(?,INTERVAL ? MINUTE),?)",[userId,q.service.id,body.service_type,q.origin.id,q.destination.id,pickupAddress,body.pickup.latitude,body.pickup.longitude,dropoffAddress,body.dropoff.latitude,body.dropoff.longitude,body.departure_at?'scheduled':'now',utcSQLDate(when),q.persons,q.route.km,q.route.minutes,snapshot,q.suggested,amount,q.service.pricing_unit,q.service.currency,utcSQLDate(when),Number(q.service.request_expiry_minutes||30),key]);
    if(body.service_type==='parcel')await c.query('INSERT INTO city_to_city_parcel_details (request_id,sender_name,sender_phone,recipient_name,recipient_phone,description,weight_kg) VALUES (?,?,?,?,?,?,?)',[r.insertId,owner[0].User_Name||'Sender',owner[0].Mobile,safeText(body.recipient_name,'recipient name',100),safeText(body.recipient_phone,'recipient phone',25),safeText(body.parcel_description,'parcel description'),q.weight]);
    return {id:r.insertId};
   });
  },
  async presence(userId,body){
   const online=body.online===true;if(!online)return transaction(async c=>{const d=await driver(c,userId);await c.query('UPDATE city_to_city_drivers SET is_online=0 WHERE id=?',[d.id]);return {online:false};});
   const city=await geo.city(coordinate(body));
   return transaction(async c=>{await enabled(c);const d=await driver(c,userId);await busy(c,userId,d.id);await c.query('UPDATE city_to_city_drivers SET is_online=1,current_city_id=?,presence_updated_at=UTC_TIMESTAMP() WHERE id=?',[city.id,d.id]);return {online:true,city};});
  },
  async requests(userId){return transaction(async c=>{await enabled(c);const d=await driver(c,userId);if(!Number(d.is_online)||!d.current_city_id||Number(d.presence_is_fresh)!==1)return {requests:[],online:false};
   await busy(c,userId,d.id);
   const [rows]=await c.query("SELECT r.id,r.service_type,r.pickup_address,r.dropoff_address,r.pickup_lat,r.pickup_lng,r.dropoff_lat,r.dropoff_lng,r.passenger_count,r.customer_offer_amount AS fare,r.currency,DATE_FORMAT(r.requested_departure_at,'%Y-%m-%dT%H:%i:%s.000Z') AS requested_departure_at,DATE_FORMAT(r.expires_at,'%Y-%m-%dT%H:%i:%s.000Z') AS expires_at,p.weight_kg,p.description AS parcel_description,u.User_Name AS rider_name,o.City_Name AS origin_city,t.City_Name AS destination_city FROM city_to_city_requests r JOIN users u ON u.User_ID_Pk=r.customer_user_id JOIN city o ON o.ID_PK=r.origin_city_id JOIN city t ON t.ID_PK=r.destination_city_id LEFT JOIN city_to_city_parcel_details p ON p.request_id=r.id JOIN city_to_city_driver_services ds ON ds.city_to_city_driver_id=? AND ds.service_id=r.service_id AND ds.is_enabled=1 AND ds.approval_status='approved' JOIN city_to_city_services s ON s.id=r.service_id AND s.is_active=1 WHERE r.origin_city_id=? AND r.customer_user_id<>? AND r.status='open' AND r.expires_at>UTC_TIMESTAMP() AND EXISTS (SELECT 1 FROM city_to_city_vehicles v WHERE v.city_to_city_driver_id=? AND v.is_active=1 AND v.approval_status='approved' AND ((r.service_type='parcel' AND v.max_parcel_weight_kg>=p.weight_kg) OR (r.service_type<>'parcel' AND v.passenger_capacity>=r.passenger_count))) ORDER BY r.created_at LIMIT 50",[d.id,d.current_city_id,userId,d.id]);return {requests:rows,online:true,city_id:d.current_city_id};});},
  async accept(userId,requestId){return transaction(async c=>{
   await enabled(c);const d=await driver(c,userId);await busy(c,userId,d.id);
   if(!Number(d.is_online)||Number(d.presence_is_fresh)!==1)throw fail(409,'Refresh your current city before accepting.');
   const [rows]=await c.query("SELECT r.*,p.weight_kg,(r.expires_at>UTC_TIMESTAMP()) AS request_is_fresh,DATE_FORMAT(r.requested_departure_at,'%Y-%m-%dT%H:%i:%s.000Z') AS requested_departure_at FROM city_to_city_requests r LEFT JOIN city_to_city_parcel_details p ON p.request_id=r.id WHERE r.id=? FOR UPDATE",[id(requestId)]);const r=rows[0];
   if(!r||r.status!=='open'||Number(r.request_is_fresh)!==1)throw fail(409,'This request is no longer available.');
   if(r.customer_user_id===userId||Number(r.origin_city_id)!==Number(d.current_city_id))throw fail(403,'This request is outside your current city.');
   const [permissions]=await c.query("SELECT ds.id FROM city_to_city_driver_services ds JOIN city_to_city_services s ON s.id=ds.service_id WHERE ds.city_to_city_driver_id=? AND ds.service_id=? AND ds.is_enabled=1 AND ds.approval_status='approved' AND s.is_active=1",[d.id,r.service_id]);if(!permissions.length)throw fail(403,'This service is not enabled for your profile.');
   const [vehicles]=await c.query("SELECT * FROM city_to_city_vehicles WHERE city_to_city_driver_id=? AND is_active=1 AND approval_status='approved' AND ((?='parcel' AND max_parcel_weight_kg>=?) OR (?<>'parcel' AND passenger_capacity>=?)) LIMIT 1 FOR UPDATE",[d.id,r.service_type,r.weight_kg,r.service_type,r.passenger_count]);if(!vehicles.length)throw fail(409,'Your vehicle does not have enough capacity.');
   const v=vehicles[0];const [trip]=await c.query("INSERT INTO city_to_city_trips (city_to_city_driver_id,vehicle_id,service_id,trip_type,origin_city_id,destination_city_id,scheduled_departure_at,passenger_capacity,parcel_capacity_kg,status) VALUES (?,?,?,?,?,?,?,?,?,'boarding')",[d.id,v.id,r.service_id,r.service_type,r.origin_city_id,r.destination_city_id,utcSQLDate(r.requested_departure_at),r.service_type==='parcel'?0:v.passenger_capacity,r.service_type==='parcel'?v.max_parcel_weight_kg:null]);
   const fare=Number(r.customer_offer_amount);const snapshot=JSON.parse(r.fare_snapshot||'{}');const fee=Math.min(fare,Math.round((fare*Number(snapshot.commission_percent||0)/100+Number(snapshot.commission_fixed||0))*100)/100);
   const [booking]=await c.query('INSERT INTO city_to_city_bookings (request_id,trip_id,fare_snapshot,passenger_count,unit_price,fare_total,platform_fee,driver_earning,currency) VALUES (?,?,?,?,?,?,?,?,?)',[r.id,trip.insertId,r.fare_snapshot,r.passenger_count,r.service_type==='shared'?fare/r.passenger_count:fare,fare,fee,Math.round((fare-fee)*100)/100,r.currency]);
   await c.query('INSERT INTO city_to_city_dispatch (request_id,city_to_city_driver_id,trip_id,booking_id) VALUES (?,?,?,?)',[r.id,d.id,trip.insertId,booking.insertId]);
   await c.query("UPDATE city_to_city_requests SET status='booked' WHERE id=?",[r.id]);await c.query('UPDATE city_to_city_drivers SET is_online=0 WHERE id=?',[d.id]);return {id:r.id,trip_id:trip.insertId};
  });},
  async status(userId,requestId){
   const [rows]=await pool.query("SELECT r.*,o.City_Name AS origin_city,t.City_Name AS destination_city,b.status AS booking_status,b.id AS booking_id,tr.status AS trip_status,d.full_name AS driver_name,u.Mobile AS driver_phone,v.registration_number AS number_plate,(r.expires_at>UTC_TIMESTAMP()) AS request_is_fresh,DATE_FORMAT(r.expires_at,'%Y-%m-%dT%H:%i:%s.000Z') AS expires_at,DATE_FORMAT(r.requested_departure_at,'%Y-%m-%dT%H:%i:%s.000Z') AS requested_departure_at FROM city_to_city_requests r JOIN city o ON o.ID_PK=r.origin_city_id JOIN city t ON t.ID_PK=r.destination_city_id LEFT JOIN city_to_city_dispatch a ON a.request_id=r.id LEFT JOIN city_to_city_drivers d ON d.id=a.city_to_city_driver_id LEFT JOIN users u ON u.User_ID_Pk=d.user_id LEFT JOIN city_to_city_vehicles v ON v.id=(SELECT vehicle_id FROM city_to_city_trips WHERE id=a.trip_id) LEFT JOIN city_to_city_trips tr ON tr.id=a.trip_id LEFT JOIN city_to_city_bookings b ON b.id=a.booking_id WHERE r.id=? AND r.customer_user_id=?",[id(requestId),userId]);
   if(!rows.length)throw fail(404,'Request not found.');const r=rows[0];return {...r,status:r.status==='open'&&Number(r.request_is_fresh)!==1?'expired':r.status};
  },
  async active(userId){const [rows]=await pool.query("SELECT r.id FROM city_to_city_requests r LEFT JOIN city_to_city_bookings b ON b.request_id=r.id WHERE r.customer_user_id=? AND ((r.status='open' AND r.expires_at>UTC_TIMESTAMP()) OR b.status IN ('confirmed','picked_up')) ORDER BY r.id DESC LIMIT 1",[userId]);return rows[0]?this.status(userId,rows[0].id):null;},
  async cancel(userId,requestId){return transaction(async c=>{const [rows]=await c.query('SELECT id,status FROM city_to_city_requests WHERE id=? AND customer_user_id=? FOR UPDATE',[id(requestId),userId]);if(!rows.length)throw fail(404,'Request not found.');if(rows[0].status!=='open')throw fail(409,'Only a searching request can be cancelled here.');await c.query("UPDATE city_to_city_requests SET status='cancelled' WHERE id=?",[rows[0].id]);return {id:rows[0].id,status:'cancelled'};});},
  async driverActive(userId){const [rows]=await pool.query("SELECT r.id,r.service_type,r.pickup_address,r.dropoff_address,r.pickup_lat,r.pickup_lng,r.dropoff_lat,r.dropoff_lng,r.passenger_count,r.customer_offer_amount AS fare,p.weight_kg,p.recipient_name,p.recipient_phone,p.description AS parcel_description,tr.id AS trip_id,tr.status AS trip_status,u.User_Name AS rider_name,u.Mobile AS rider_phone FROM city_to_city_dispatch a JOIN city_to_city_drivers d ON d.id=a.city_to_city_driver_id JOIN city_to_city_requests r ON r.id=a.request_id JOIN city_to_city_trips tr ON tr.id=a.trip_id JOIN users u ON u.User_ID_Pk=r.customer_user_id LEFT JOIN city_to_city_parcel_details p ON p.request_id=r.id WHERE d.user_id=? AND tr.status IN ('boarding','in_progress') LIMIT 1",[userId]);return rows[0]||null;},
  async progress(userId,tripId,action){if(!['start','complete','cancel'].includes(action))throw fail(400,'Invalid trip action.');return transaction(async c=>{const d=await driver(c,userId);const [rows]=await c.query('SELECT * FROM city_to_city_trips WHERE id=? AND city_to_city_driver_id=? FOR UPDATE',[id(tripId),d.id]);const t=rows[0];if(!t)throw fail(404,'Trip not found.');if(action==='start'&&t.status!=='boarding'||action==='complete'&&t.status!=='in_progress'||action==='cancel'&&!['boarding','in_progress'].includes(t.status))throw fail(409,'Trip status changed. Refresh and try again.');await c.query("UPDATE city_to_city_trips SET status=?,actual_started_at=IF(?='in_progress',UTC_TIMESTAMP(),actual_started_at),actual_completed_at=IF(?='completed',UTC_TIMESTAMP(),actual_completed_at) WHERE id=?",[{start:'in_progress',complete:'completed',cancel:'cancelled'}[action],{start:'in_progress',complete:'completed',cancel:'cancelled'}[action],{start:'in_progress',complete:'completed',cancel:'cancelled'}[action],t.id]);await c.query('UPDATE city_to_city_bookings SET status=? WHERE trip_id=?',[{start:'picked_up',complete:'completed',cancel:'cancelled'}[action],t.id]);return {trip_id:t.id,action};});}
 };
}
module.exports={createCityToCityDispatch};
