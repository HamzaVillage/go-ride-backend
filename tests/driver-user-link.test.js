const test=require('node:test'),assert=require('node:assert/strict');
const {assertDriverUserLink}=require('../services/driverUserLink');
const row={user_id:42,phone:'0300-1234567'};
function conn({missing=false,phone='+923001234567',role='rider',deleted=0,profiles=1}={}){return {query:async sql=>{if(sql.includes('FROM users'))return [missing?[]:[{User_ID_Pk:42,Mobile:phone,Role:role,AccountDeleted:deleted}]];return [Array.from({length:profiles},(_,i)=>({id:i+1}))];}};}
test('approval validates the canonical owner with normalized phone formats',async()=>{assert.equal((await assertDriverUserLink(conn(),row)).User_ID_Pk,42);});
test('missing, wrong, staff, deleted and shared links cannot be approved',async()=>{for(const setup of [{missing:true},{phone:'03007654321'},{role:'employee'},{role:'admin'},{deleted:1},{profiles:2},{profiles:0}])await assert.rejects(assertDriverUserLink(conn(setup),row),{status:409});await assert.rejects(assertDriverUserLink(conn(),{...row,user_id:null}),{status:409});});
