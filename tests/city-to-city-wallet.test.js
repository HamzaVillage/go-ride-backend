const test=require('node:test'),assert=require('node:assert/strict');
const {createCityToCityWallet,settleCommission,balance}=require('../services/cityToCityWallet');
function fixture({minimum=500,approved=true,activeAdmin=true,failCredit=false}={}){
 const state={requests:[],ledger:[],queries:[],commits:0,rollbacks:0,tripStatus:"in_progress"};let queue=Promise.resolve();
 async function query(sql,args=[]){state.queries.push({sql,args});
  if(sql.includes('FROM employee WHERE'))return [[{emp_id:7,account_type:'superadmin',is_active:activeAdmin?1:0,is_deleted:0}]];
  if(sql==='SELECT id FROM city_to_city_drivers WHERE user_id=?')return [args[0]===101?[{id:1}]:args[0]===202?[{id:2}]:[]];
  if(sql.startsWith('SELECT id,user_id,application_status'))return [[{id:args[0],user_id:args[0]===1?101:202,application_status:approved?'approved':'pending'}]];
  if(sql.startsWith('SELECT s.id,s.minimum_topup_amount'))return [[{id:1,minimum_topup_amount:minimum}]];
  if(sql.startsWith('SELECT s.minimum_topup_amount'))return [[{minimum_topup_amount:minimum}]];
  if(sql.startsWith('SELECT id,amount,service_id'))return [state.requests.filter(r=>r.city_to_city_driver_id===args[0]&&r.idempotency_key===args[1])];
  if(sql.startsWith('INSERT INTO city_to_city_topup_requests')){if(state.requests.some(r=>r.payment_method===args[4]&&r.payment_reference===args[5]))throw Object.assign(new Error(),{code:'ER_DUP_ENTRY'});const id=state.requests.length+1;state.requests.push({id,city_to_city_driver_id:args[0],service_id:args[1],amount:args[2],minimum_topup_snapshot:args[3],payment_method:args[4],payment_reference:args[5],idempotency_key:args[6],status:sql.includes("'approved'")?'approved':'pending',reviewed_by_employee_id:args[7]});return [{insertId:id}];}
  if(sql.startsWith('SELECT * FROM city_to_city_topup_requests'))return [state.requests.filter(r=>r.id===args[0]&&r.city_to_city_driver_id===args[1])];
  if(sql.startsWith('INSERT INTO city_to_city_wallet')){if(failCredit)throw new Error('INSERT_FAILED');if(state.ledger.some(r=>r.reference_id===args[2]))throw Object.assign(new Error(),{code:'ER_DUP_ENTRY'});state.ledger.push({id:state.ledger.length+1,city_to_city_driver_id:args[0],amount:args[1],reference_id:args[2],transaction_type:sql.includes("'credit'")?'credit':'debit'});return [{insertId:state.ledger.length}];}
  if(sql.startsWith('UPDATE city_to_city_topup_requests')){state.requests.find(r=>r.id===args[3]).status=args[0];return [{}];}
  if(sql.startsWith('SELECT COALESCE(SUM(CASE'))return [[{balance:state.ledger.filter(r=>r.city_to_city_driver_id===args[0]).reduce((s,r)=>s+(r.transaction_type==='credit'?1:-1)*Number(r.amount),0)}]];
  if(sql.startsWith('SELECT *, (presence_updated_at'))return [[{id:1,application_status:'approved'}]];
  if(sql.startsWith('SELECT * FROM city_to_city_trips'))return [[{id:12,status:state.tripStatus}]];
  if(sql.startsWith('UPDATE city_to_city_trips SET status=')){state.tripStatus=args[0];return [{}];}
  if(sql.startsWith('UPDATE city_to_city_bookings SET status='))return [{}];
  if(sql.startsWith('SELECT SUM(platform_fee)'))return [[{fee:100}]];
  if(sql.startsWith('SELECT id,amount,city_to_city_driver_id'))return [state.ledger.filter(r=>r.reference_id===args[0])];
  throw new Error(sql);
 }
 const pool={query,getConnection:async()=>{let release,snapshot;return {query,async beginTransaction(){const previous=queue;queue=new Promise(r=>{release=r;});await previous;snapshot=structuredClone({requests:state.requests,ledger:state.ledger,tripStatus:state.tripStatus});},async commit(){state.commits++;release();},async rollback(){state.requests=snapshot.requests;state.ledger=snapshot.ledger;state.tripStatus=snapshot.tripStatus;state.rollbacks++;release();},release(){}};}};
 return {state,pool,wallet:createCityToCityWallet(pool)};
}
const body={service_id:1,amount:'500.00',payment_method:'bank_transfer',payment_reference:'BANK-REF-123',idempotency_key:'c2c-topup-test-key-1234'};
test('submission is pending and does not credit; concurrent approvals credit exactly once',async()=>{
 const f=fixture();const r=await f.wallet.submit(101,body);assert.equal(r.status,'pending');assert.equal(f.state.ledger.length,0);
 const results=await Promise.all([f.wallet.review(1,r.id,7,{status:'approved'}),f.wallet.review(1,r.id,7,{status:'approved'})]);
 assert.equal(f.state.ledger.length,1);assert.equal(results[1].already_reviewed,true);assert.equal(await balance(f.pool,1),50000);
 assert.ok(f.state.queries.every(q=>! /\bdriver_wallet\b|\buser_wallets\b|UPDATE users|UPDATE drivers/.test(q.sql)));
});
test('submission retries, conflicts, minimum and payment reference uniqueness are enforced',async()=>{
 const f=fixture();await f.wallet.submit(101,body);assert.equal((await f.wallet.submit(101,body)).already_submitted,true);assert.equal(f.state.requests.length,1);
 await assert.rejects(f.wallet.submit(101,{...body,amount:600}),{status:409});
 await assert.rejects(f.wallet.submit(101,{...body,amount:499}),{status:409});
 await assert.rejects(f.wallet.submit(202,{...body,idempotency_key:'different-key-123456'}),{status:409});
 const min=fixture();await assert.rejects(min.wallet.submit(101,{...body,amount:499}),{status:400});
 assert.equal(min.state.requests.length,0);
});
test('rejection never credits; reviewed decisions and cross-driver IDs cannot be changed',async()=>{
 const f=fixture();await f.wallet.submit(101,body);await assert.rejects(f.wallet.review(2,1,7,{status:'approved'}),{status:404});
 await f.wallet.review(1,1,7,{status:'rejected',reason:'Payment not received'});assert.equal(f.state.ledger.length,0);
 await assert.rejects(f.wallet.review(1,1,7,{status:'approved'}),{status:409});
});
test('inactive admins, unapproved drivers and failed credits cannot post balances',async()=>{
 await assert.rejects(fixture({approved:false}).wallet.submit(101,body),{status:403});
 const f=fixture({activeAdmin:false});await f.wallet.submit(101,body);await assert.rejects(f.wallet.review(1,1,7,{status:'approved'}),{status:401});assert.equal(f.state.ledger.length,0);
 const failed=fixture({failCredit:true});await failed.wallet.submit(101,body);await assert.rejects(failed.wallet.review(1,1,7,{status:'approved'}));assert.equal(failed.state.requests[0].status,'pending');assert.equal(failed.state.ledger.length,0);
});
test('completion debits stored commission once and keeps the other wallet independent',async()=>{
 const f=fixture();await f.wallet.submit(101,body);await f.wallet.review(1,1,7,{status:'approved'});
 await settleCommission(f.pool,1,12);await settleCommission(f.pool,1,12);
 assert.equal(f.state.ledger.length,2);assert.equal(await balance(f.pool,1),40000);assert.equal(await balance(f.pool,2),0);
 assert.equal(f.state.ledger[1].reference_id,'C2C_COMMISSION_12');
});
test('invalid top-ups fail before a database connection is used',async()=>{
 for(const change of [{amount:-1},{amount:'1.001'},{service_id:0},{payment_reference:''},{payment_method:'cash'},{idempotency_key:'short'}]){const f=fixture();await assert.rejects(f.wallet.submit(101,{...body,...change}),{status:400});assert.equal(f.state.queries.length,0);}
});

test('trip completion and commission commit together, duplicate completion cannot debit twice',async()=>{
 const f=fixture();await f.wallet.submit(101,body);await f.wallet.review(1,1,7,{status:'approved'});
 const {createCityToCityDispatch}=require('../services/cityToCityDispatch');const dispatch=createCityToCityDispatch(f.pool,{});
 await dispatch.progress(101,12,'complete');assert.equal(f.state.tripStatus,'completed');assert.equal(await balance(f.pool,1),40000);
 await assert.rejects(dispatch.progress(101,12,'complete'),{status:409});assert.equal(f.state.ledger.length,2);
});
test('cancelling a trip does not charge commission',async()=>{
 const f=fixture();const {createCityToCityDispatch}=require('../services/cityToCityDispatch');await createCityToCityDispatch(f.pool,{}).progress(101,12,'cancel');assert.equal(f.state.ledger.length,0);
});

test('failure after commission insertion rolls the debit back with trip completion',async()=>{
 const f=fixture();await f.wallet.submit(101,body);await f.wallet.review(1,1,7,{status:'approved'});
 const pool={...f.pool,getConnection:async()=>{const c=await f.pool.getConnection();const query=c.query;c.query=async(sql,args)=>{if(sql.startsWith('UPDATE city_to_city_trips SET status='))throw new Error('TRIP_UPDATE_FAILED');return query(sql,args);};return c;}};
 const {createCityToCityDispatch}=require('../services/cityToCityDispatch');await assert.rejects(createCityToCityDispatch(pool,{}).progress(101,12,'complete'));
 assert.equal(f.state.tripStatus,'in_progress');assert.equal(f.state.ledger.length,1);assert.equal(await balance(f.pool,1),50000);
});

test('admin direct credit works without a mobile request and retries cannot double credit',async()=>{
 const f=fixture(),key='a1234567-1234-4234-8234-123456789012';
 const payment={amount:500,payment_method:'bank_transfer',payment_reference:'DIRECT-REF-001'};
 await Promise.all([f.wallet.credit(1,7,payment,key),f.wallet.credit(1,7,payment,key)]);
 assert.equal(f.state.requests.length,1);assert.equal(f.state.requests[0].status,'approved');assert.equal(f.state.ledger.length,1);assert.equal(await balance(f.pool,1),50000);
 await assert.rejects(f.wallet.credit(1,7,{...payment,amount:600},key),{status:409});
 await assert.rejects(f.wallet.credit(2,7,payment,'b1234567-1234-4234-8234-123456789012'),{status:409});
 assert.equal(await balance(f.pool,2),0);
});

test('search eligibility is service-specific and zero balance never permits searching',async()=>{
 const {searchEligibility}=require('../services/cityToCityWallet');let funds=400;
 const conn={query:async sql=>sql.startsWith('SELECT COALESCE')?[[{balance:funds}]]:[[{id:1,minimum_required_balance:300},{id:2,minimum_required_balance:500}]]};
 assert.deepEqual((await searchEligibility(conn,1)).eligible_service_ids,[1]);funds=0;assert.equal((await searchEligibility(conn,1)).topup_required,true);funds=500;assert.deepEqual((await searchEligibility(conn,1)).eligible_service_ids,[1,2]);
});
