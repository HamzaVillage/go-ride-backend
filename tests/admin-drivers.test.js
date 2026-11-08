const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const {once} = require('node:events');
const { createAdminDriversService, amountInPaisa, pagination } = require('../services/adminDrivers');
const { createAdminRouter } = require('../routers/admin');
const key = 'd4e5bafb-e4f0-4acb-8f57-32addf6628ce';
const body = {amount:'250.50',payment_method:'bank_transfer',note:'Receipt 123'};
function ledgerFixture({driverExists=true,adminActive=true,failInsert=false,failBalance=false,failCommit=false}={}) {
    const state = {entries:[], released:0, commits:0, rollbacks:0, lockTail:Promise.resolve()};
    const pool = {async getConnection(){let unlock;let staged=[];return {
        async beginTransaction(){},
        async commit(){if(failCommit)throw new Error('commit failed');state.entries.push(...staged);staged=[];state.commits++;unlock?.();unlock=null;},
        async rollback(){staged=[];state.rollbacks++;unlock?.();unlock=null;},
        release(){state.released++;},
        async query(sql,args){
            if(sql.includes('FROM users')) {assert.match(sql,/LOCK IN SHARE MODE/);return [adminActive?[{User_ID_Pk:7}]:[]];}
            if(sql.includes('FROM drivers WHERE id')) {
                const previous=state.lockTail;state.lockTail=new Promise(resolve=>{unlock=resolve;});await previous;
                assert.match(sql,/FOR UPDATE/);return [driverExists?[{id:args[0]}]:[]];
            }
            if(sql.includes('reference_id = ?')) return [[...state.entries,...staged].filter(e=>e.driver_id===args[0]&&e.reference_id===args[1])];
            if(sql.startsWith('INSERT INTO driver_wallet')) {
                if(failInsert)throw new Error('private insert failure');
                const row={id:state.entries.length+1,driver_id:args[0],amount:args[1],description:args[2],reference_id:args[3],payment_method:args[4],created_by:args[5],transaction_type:'credit',status:'completed'};
                staged.push(row);return [{insertId:row.id}];
            }
            if(sql.includes('FROM driver_wallet WHERE driver_id')) {
                if(failBalance)throw new Error('balance unavailable');
                return [[{balance:[...state.entries,...staged].filter(e=>e.driver_id===args[0]).reduce((sum,e)=>sum+(e.transaction_type==='credit'?1:-1)*Number(e.amount),0)}]];
            }
            throw new Error(`Unexpected SQL ${sql}`);
        }
    };}};
    return {state,pool,service:createAdminDriversService(pool)};
}
test('top-up posts a completed driver ledger credit, records actor, and returns balance',async()=>{
    const f=ledgerFixture();const result=await f.service.topup('10',7,body,key);
    assert.equal(result.wallet_balance,250.5);assert.equal(result.credited_amount,250.5);assert.equal(result.already_applied,false);
    assert.equal(f.state.entries[0].created_by,7);assert.equal(f.state.entries[0].driver_id,10);assert.equal(f.state.entries[0].amount,'250.50');assert.match(f.state.entries[0].reference_id,/^ADMIN_TOPUP_/);
    assert.equal(f.state.commits,1);assert.equal(f.state.released,1);
});
test('simultaneous retries credit once and return the original transaction',async()=>{
    const f=ledgerFixture();const results=await Promise.all([f.service.topup(10,7,body,key),f.service.topup(10,7,body,key)]);
    assert.equal(f.state.entries.length,1);assert.equal(results[0].transaction_id,results[1].transaction_id);assert.equal(results[1].already_applied,true);assert.equal(results[1].wallet_balance,250.5);
});
test('different concurrent top-ups both contribute to the resulting balance',async()=>{
    const f=ledgerFixture();const results=await Promise.all([f.service.topup(10,7,body,key),f.service.topup(10,7,body,'12345678-1234-4234-8234-123456789abc')]);
    assert.equal(f.state.entries.length,2);assert.equal(results[1].wallet_balance,501);
});
test('idempotency key conflicts cannot change amount, method, note, or actor',async()=>{
    const f=ledgerFixture();await f.service.topup(10,7,body,key);
    for(const [actor,details] of [[7,{...body,amount:'251'}],[7,{...body,payment_method:'cash'}],[7,{...body,note:'changed'}],[8,body]])await assert.rejects(f.service.topup(10,actor,details,key),{status:409});
    assert.equal(f.state.entries.length,1);
});
for(const config of [{driverExists:false},{adminActive:false},{failInsert:true},{failBalance:true},{failCommit:true}])test(`failed top-up rolls back and releases: ${JSON.stringify(config)}`,async()=>{
    const f=ledgerFixture(config);await assert.rejects(f.service.topup(10,7,body,key));assert.equal(f.state.entries.length,0);assert.equal(f.state.rollbacks,1);assert.equal(f.state.released,1);
});
test('driver top-up uses its own ledger even when balance is negative',async()=>{
    const f=ledgerFixture();f.state.entries.push({id:1,driver_id:10,transaction_type:'debit',status:'completed',amount:400});
    assert.equal((await f.service.topup(10,7,body,key)).wallet_balance,-149.5);
});
test('amount validation preserves paisa and rejects malformed or excessive values',()=>{
    assert.equal(amountInPaisa('0.01'),1);assert.equal(amountInPaisa('99999999.99'),9999999999);assert.equal(amountInPaisa(12.35),1235);
    for(const value of [0,-1,'0','1.001','100000000','1e3',true,null,{},Infinity,NaN,'1,000',' 10'])assert.throws(()=>amountInPaisa(value),{status:400});
    for(const query of [{page:0},{limit:101},{page:'1 OR 1=1'},{page:['1']},{limit:'2.5'}])assert.throws(()=>pagination(query),{status:400});
});
test('invalid top-up requests never acquire a database connection',async()=>{
    const service=createAdminDriversService({getConnection(){throw new Error('should not acquire');}});
    for(const args of [[0,7,body,key],[10,0,body,key],[10,7,null,key],[10,7,body,'missing'],[10,7,{...body,payment_method:'wallet'},key],[10,7,{...body,note:'a'.repeat(501)},key]])await assert.rejects(service.topup(...args),{status:400});
});
test('list queries are paginated, parameterized, wallet-aware, and exclude private columns',async()=>{
    let released=false;const queries=[];
    const pool={getConnection:async()=>({release(){released=true;},async query(sql,args){queries.push({sql,args});if(sql.includes('COUNT(*)'))return [[{total:45}]];return [[{id:10,name:'Test Driver',wallet_balance:'100.20',rating:'5',is_online:1,is_available:0,status:'unverified'}]];}})};
    const result=await createAdminDriversService(pool).list({page:'2',limit:'20',status:'unverified',online:'online',q:'50%_'});
    assert.deepEqual(result.pagination,{page:2,limit:20,total:45,totalPages:3});assert.equal(result.drivers[0].wallet_balance,100.2);assert.equal(result.drivers[0].driver_code,'GRD-1010');assert.equal(result.drivers[0].is_online,true);
    assert.deepEqual(queries[1].args.slice(-2),[20,20]);assert.equal(queries[0].args[2],'%50=%=_%');assert.doesNotMatch(queries[1].sql,/d\.password|d\.fcm_token|SELECT \*/i);assert.match(queries[1].sql,/driver_wallet/);assert.equal(released,true);
});
test('wallet history returns 404 for absent drivers and releases connection',async()=>{
    let released=false;const service=createAdminDriversService({getConnection:async()=>({release(){released=true;},query:async()=>[[]]})});
    await assert.rejects(service.wallet(999),{status:404});assert.equal(released,true);
});
test('admin HTTP routes reject rider, superadmin, missing, and forged tokens before accessing DB',async t=>{
    const secret='test-admin-drivers-secret';const old=process.env.JWT_SECRET;process.env.JWT_SECRET=secret;
    t.after(()=>{if(old===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=old;});
    let calls=0;const app=express();app.use(express.json());app.use('/admin',createAdminRouter({getConnection(){calls++;throw new Error('database should not be reached');}}));
    const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
    for(const token of ['',jwt.sign({userId:7,role:'rider'},secret),jwt.sign({userId:7,role:'superadmin'},secret),jwt.sign({userId:7,role:'admin'},'forged-secret')])for(const path of ['/admin/overview','/admin/drivers','/admin/drivers/10/wallet','/admin/drivers/10/topups']){
        const response=await fetch(origin+path,{method:path.endsWith('topups')?'POST':'GET',headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,401);await response.json();
    }assert.equal(calls,0);
});
test('HTTP top-up uses authenticated admin identity and ignores body identity',async t=>{
    const f=ledgerFixture();const old=process.env.JWT_SECRET;process.env.JWT_SECRET='route-identity-secret';t.after(()=>{if(old===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=old;});
    const app=express();app.use(express.json());app.use('/admin',createAdminRouter(f.pool));const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await once(server,'listening');
    const token=jwt.sign({userId:7,role:'admin'},process.env.JWT_SECRET,{expiresIn:'1h'});
    const response=await fetch(`http://127.0.0.1:${server.address().port}/admin/drivers/10/topups`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({...body,created_by:999,admin_id:999})});
    assert.equal(response.status,200);assert.equal((await response.json()).data.driver_id,10);assert.equal(f.state.entries[0].created_by,7);
});
