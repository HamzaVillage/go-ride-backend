const { fail, getAccess } = require('./employeeAccess');
const { amountInPaisa, pagination } = require('./adminDrivers');
const METHODS=['bank_transfer','easypaisa','jazzcash'];
const id=v=>{if(!/^[1-9]\d*$/.test(String(v))||!Number.isSafeInteger(Number(v)))throw fail(400,'Invalid record ID.');return Number(v);};
const money=n=>(Number(n)/100).toFixed(2);
async function balance(conn,driverId){
 const [rows]=await conn.query("SELECT COALESCE(SUM(CASE WHEN transaction_type='credit' THEN amount ELSE -amount END),0) AS balance FROM city_to_city_wallet WHERE city_to_city_driver_id=?",[driverId]);
 const cents=Math.round(Number(rows[0]?.balance||0)*100);if(!Number.isSafeInteger(cents))throw fail(500,'Wallet balance is outside supported limits.');return cents;
}
async function searchEligibility(conn,driverId){
 const cents=await balance(conn,driverId);
 const [services]=await conn.query("SELECT s.id,s.minimum_required_balance,s.minimum_topup_amount FROM city_to_city_services s JOIN city_to_city_driver_services ds ON ds.service_id=s.id WHERE ds.city_to_city_driver_id=? AND ds.is_enabled=1 AND ds.approval_status='approved' AND s.is_active=1",[driverId]);
 const eligible=services.filter(s=>cents>0&&cents>=Math.round(Number(s.minimum_required_balance||0)*100));
 const required=services.length?Math.min(...services.map(s=>Number(s.minimum_required_balance||0))):0;
 return {can_search:eligible.length>0,topup_required:services.length>0&&!eligible.length,wallet_balance:Number(money(cents)),minimum_required_balance:required,eligible_service_ids:eligible.map(s=>Number(s.id)),message:services.length?'Top-up required':'No approved active services are available.'};
}
// All wallet writers hold this City-to-City driver lock, independent of normal drivers.
async function lockDriver(conn,driverId){const [rows]=await conn.query('SELECT id,user_id,application_status,full_name,driver_code FROM city_to_city_drivers WHERE id=? FOR UPDATE',[id(driverId)]);if(!rows[0])throw fail(404,'City-to-city driver not found.');return rows[0];}
async function settleCommission(conn,driverId,tripId){
 const [rows]=await conn.query('SELECT SUM(platform_fee) AS fee FROM city_to_city_bookings WHERE trip_id=?',[tripId]);
 const cents=Math.round(Number(rows[0]?.fee||0)*100);
 if(!Number.isSafeInteger(cents)||cents<0)throw fail(500,'Invalid stored commission.');
 if(!cents)return;
 const reference=`C2C_COMMISSION_${tripId}`;
 const [old]=await conn.query('SELECT id,amount,city_to_city_driver_id FROM city_to_city_wallet WHERE reference_id=?',[reference]);
 if(old.length){if(Number(old[0].city_to_city_driver_id)!==driverId||Math.round(Number(old[0].amount)*100)!==cents)throw fail(409,'Commission ledger conflict.');return;}
 await conn.query("INSERT INTO city_to_city_wallet (city_to_city_driver_id,transaction_type,amount,reference_id,description,trip_id,created_at) VALUES (?,'debit',?,?,?,?,UTC_TIMESTAMP())",[driverId,money(cents),reference,`Commission for city-to-city trip #${tripId}`,tripId]);
}
function createCityToCityWallet(pool){
 async function tx(fn){const c=await pool.getConnection();try{await c.beginTransaction();const result=await fn(c);await c.commit();return result;}catch(e){await c.rollback().catch(()=>{});if(e.code==='ER_DUP_ENTRY')throw fail(409,'This payment reference has already been submitted.');throw e;}finally{c.release();}}
 async function owner(userId){const [d]=await pool.query('SELECT id FROM city_to_city_drivers WHERE user_id=?',[userId]);if(!d[0])throw fail(403,'A city-to-city driver profile is required.');return d[0].id;}
 async function summary(driverId,query={}){
  const {page,limit,offset}=pagination(query);
  return tx(async c=>{
   const d=await lockDriver(c,driverId);
   const [services]=await c.query("SELECT s.id,s.name,s.code,s.minimum_topup_amount,s.minimum_required_balance FROM city_to_city_services s JOIN city_to_city_driver_services ds ON ds.service_id=s.id WHERE ds.city_to_city_driver_id=? AND ds.is_enabled=1 AND ds.approval_status='approved' AND s.is_active=1 ORDER BY s.sort_order,s.id",[d.id]);
   const [transactions]=await c.query("SELECT id,transaction_type,amount,reference_id,description,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.000Z') AS created_at FROM city_to_city_wallet WHERE city_to_city_driver_id=? ORDER BY id DESC LIMIT ? OFFSET ?",[d.id,limit,offset]);
   const [count]=await c.query('SELECT COUNT(*) AS total FROM city_to_city_wallet WHERE city_to_city_driver_id=?',[d.id]);
   const [requests]=await c.query("SELECT t.id,t.service_id,s.name AS service_name,t.amount,t.payment_method,t.payment_reference,t.status,t.review_reason,DATE_FORMAT(t.created_at,'%Y-%m-%dT%H:%i:%s.000Z') AS created_at FROM city_to_city_topup_requests t JOIN city_to_city_services s ON s.id=t.service_id WHERE t.city_to_city_driver_id=? ORDER BY t.id DESC LIMIT 50",[d.id]);
   const [earnings]=await c.query("SELECT COALESCE(SUM(b.driver_earning),0) AS net_cash_earnings FROM city_to_city_bookings b JOIN city_to_city_trips tr ON tr.id=b.trip_id WHERE tr.city_to_city_driver_id=? AND tr.status='completed'",[d.id]);
   return {driver:{id:d.id,name:d.full_name,driver_code:d.driver_code},currency:'PKR',balance:Number(money(await balance(c,d.id))),net_cash_earnings:Number(earnings[0]?.net_cash_earnings||0),services,transactions,requests,pagination:{page,limit,total:Number(count[0].total)}};
  });
 }
 return {
  async mine(userId,query){return summary(await owner(userId),query);},
  summary,
  async eligibility(userId){const driverId=await owner(userId);return tx(async c=>{const d=await lockDriver(c,driverId);if(d.application_status!=='approved')throw fail(403,'An approved city-to-city driver profile is required.');return searchEligibility(c,driverId);});},
  async credit(driverId,actor,body={},requestKey){
   driverId=id(driverId);actor=id(actor);
   if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Invalid top-up details.');
   const cents=amountInPaisa(body.amount);
   if(![...METHODS,'cash','other'].includes(body.payment_method))throw fail(400,'Choose a valid payment method.');
   const reference=typeof body.payment_reference==='string'?body.payment_reference.trim().toUpperCase():'';
   if(!/^[A-Z0-9][A-Z0-9 /_.-]{2,119}$/.test(reference))throw fail(400,'Enter a valid payment reference (3–120 characters).');
   if(typeof requestKey!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey))throw fail(400,'A UUID v4 Idempotency-Key header is required.');
   const key=`ADMIN_${requestKey.toLowerCase()}`;
   return tx(async c=>{
    const access=await getAccess(c,actor,{lock:true});if(!access.functions.includes('city_to_city_drivers'))throw fail(403,'City-to-city driver access is required.');
    await lockDriver(c,driverId);
    const [old]=await c.query('SELECT id,amount,service_id,payment_method,payment_reference,status,reviewed_by_employee_id FROM city_to_city_topup_requests WHERE city_to_city_driver_id=? AND idempotency_key=?',[driverId,key]);
    if(old[0]){const r=old[0];if(r.status!=='approved'||Math.round(Number(r.amount)*100)!==cents||r.payment_reference!==reference||r.payment_method!==body.payment_method||Number(r.reviewed_by_employee_id)!==actor)throw fail(409,'This request key was already used with different details.');return {id:r.id,already_applied:true,balance:Number(money(await balance(c,driverId)))};}
    const [services]=await c.query("SELECT s.id,s.minimum_topup_amount FROM city_to_city_services s JOIN city_to_city_driver_services ds ON ds.service_id=s.id WHERE ds.city_to_city_driver_id=? AND ds.is_enabled=1 AND ds.approval_status='approved' AND s.is_active=1 ORDER BY s.minimum_topup_amount,s.id LIMIT 1 LOCK IN SHARE MODE",[driverId]);
    if(!services[0])throw fail(400,'This driver has no approved active service.');
    const minimum=Math.round(Number(services[0].minimum_topup_amount||0)*100);
    if(cents<minimum)throw fail(400,`Minimum top-up is PKR ${money(minimum)}.`);
    const [r]=await c.query("INSERT INTO city_to_city_topup_requests (city_to_city_driver_id,service_id,amount,minimum_topup_snapshot,payment_method,payment_reference,idempotency_key,status,reviewed_by_employee_id,created_at,reviewed_at) VALUES (?,?,?,?,?,?,?,'approved',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())",[driverId,services[0].id,money(cents),money(minimum),body.payment_method,reference,key,actor]);
    await c.query("INSERT INTO city_to_city_wallet (city_to_city_driver_id,transaction_type,amount,reference_id,description,topup_request_id,created_by_employee_id,created_at) VALUES (?,'credit',?,?,?,?,?,UTC_TIMESTAMP())",[driverId,money(cents),`C2C_TOPUP_${r.insertId}`,`Admin verified ${body.payment_method} top-up`,r.insertId,actor]);
    return {id:r.insertId,balance:Number(money(await balance(c,driverId)))};
   });
  },
  async submit(userId,body={}){
   if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Invalid top-up details.');
   const cents=amountInPaisa(body.amount),serviceId=id(body.service_id);
   if(!METHODS.includes(body.payment_method))throw fail(400,'Choose a valid payment method.');
   const reference=typeof body.payment_reference==='string'?body.payment_reference.trim().toUpperCase():'';
   if(!/^[A-Z0-9][A-Z0-9 /_.-]{2,119}$/.test(reference))throw fail(400,'Enter a valid payment reference (3–120 characters).');
   if(typeof body.idempotency_key!=='string'||!/^[-a-zA-Z0-9]{16,64}$/.test(body.idempotency_key))throw fail(400,'Invalid top-up request key.');
   const driverId=await owner(userId);
   return tx(async c=>{
    const d=await lockDriver(c,driverId);
    const [old]=await c.query('SELECT id,amount,service_id,payment_method,payment_reference,status FROM city_to_city_topup_requests WHERE city_to_city_driver_id=? AND idempotency_key=?',[d.id,body.idempotency_key]);
    if(old[0]){const r=old[0];if(Math.round(Number(r.amount)*100)!==cents||Number(r.service_id)!==serviceId||r.payment_method!==body.payment_method||r.payment_reference!==reference)throw fail(409,'This request key was already used with different details.');return {id:r.id,status:r.status,already_submitted:true};}
    if(d.application_status!=='approved')throw fail(403,'An approved city-to-city driver profile is required.');
    const [services]=await c.query("SELECT s.minimum_topup_amount FROM city_to_city_services s JOIN city_to_city_driver_services ds ON ds.service_id=s.id WHERE s.id=? AND s.is_active=1 AND ds.city_to_city_driver_id=? AND ds.is_enabled=1 AND ds.approval_status='approved' LOCK IN SHARE MODE",[serviceId,d.id]);
    if(!services[0])throw fail(403,'This service is not approved for your profile.');
    const minimum=Math.round(Number(services[0].minimum_topup_amount||0)*100);
    if(cents<minimum)throw fail(400,`Minimum top-up for this service is PKR ${money(minimum)}.`);
    const [r]=await c.query("INSERT INTO city_to_city_topup_requests (city_to_city_driver_id,service_id,amount,minimum_topup_snapshot,payment_method,payment_reference,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP())",[d.id,serviceId,money(cents),money(minimum),body.payment_method,reference,body.idempotency_key]);
    return {id:r.insertId,status:'pending'};
   });
  },
  async pending(query={}){
   const {page,limit,offset}=pagination(query),status=query.status||'pending';
   if(!['pending','approved','rejected','all'].includes(status))throw fail(400,'Invalid top-up status.');
   const where=status==='all'?'':'WHERE t.status=?',args=status==='all'?[]:[status];
   const [rows]=await pool.query(`SELECT t.id,t.city_to_city_driver_id,t.amount,t.minimum_topup_snapshot,t.payment_method,t.payment_reference,t.status,t.review_reason,d.full_name AS driver_name,d.driver_code,s.name AS service_name,DATE_FORMAT(t.created_at,'%Y-%m-%dT%H:%i:%s.000Z') AS created_at FROM city_to_city_topup_requests t JOIN city_to_city_drivers d ON d.id=t.city_to_city_driver_id JOIN city_to_city_services s ON s.id=t.service_id ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`,[...args,limit,offset]);
   const [count]=await pool.query(`SELECT COUNT(*) AS total FROM city_to_city_topup_requests t ${where}`,args);
   return {requests:rows,pagination:{page,limit,total:Number(count[0].total)}};
  },
  async review(driverId,requestId,actor,body={}){
   if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Invalid review details.');
   driverId=id(driverId);requestId=id(requestId);actor=id(actor);
   if(!['approved','rejected'].includes(body.status))throw fail(400,'Choose approve or reject.');
   const reason=typeof body.reason==='string'?body.reason.trim():'';
   if(reason.length>500||(body.status==='rejected'&&!reason))throw fail(400,'Enter a rejection reason of up to 500 characters.');
   return tx(async c=>{
    const access=await getAccess(c,actor,{lock:true});if(!access.functions.includes('city_to_city_drivers'))throw fail(403,'City-to-city driver access is required.');
    await lockDriver(c,driverId);
    const [rows]=await c.query('SELECT * FROM city_to_city_topup_requests WHERE id=? AND city_to_city_driver_id=? FOR UPDATE',[requestId,driverId]);const r=rows[0];if(!r)throw fail(404,'Top-up request not found.');
    if(r.status!=='pending'){if(r.status===body.status)return {id:r.id,status:r.status,already_reviewed:true,balance:Number(money(await balance(c,driverId)))};throw fail(409,'This request has already been reviewed.');}
    if(body.status==='approved')await c.query("INSERT INTO city_to_city_wallet (city_to_city_driver_id,transaction_type,amount,reference_id,description,topup_request_id,created_by_employee_id,created_at) VALUES (?,'credit',?,?,?,?,?,UTC_TIMESTAMP())",[driverId,r.amount,`C2C_TOPUP_${r.id}`,`Verified ${r.payment_method} top-up`,r.id,actor]);
    await c.query('UPDATE city_to_city_topup_requests SET status=?,review_reason=?,reviewed_by_employee_id=?,reviewed_at=UTC_TIMESTAMP() WHERE id=?',[body.status,reason||null,actor,r.id]);
    return {id:r.id,status:body.status,balance:Number(money(await balance(c,driverId)))};
   });
  }
 };
}
module.exports={createCityToCityWallet,balance,settleCommission,searchEligibility};
