const test=require('node:test');
const assert=require('node:assert/strict');
const {configure}=require('../scripts/configurePlatformFees');
function fixture(columns){
 const calls=[];
 const pool={async query(sql){calls.push(sql);if(sql.startsWith('SHOW'))return [columns.map(Field=>({Field}))];if(sql.startsWith('SELECT'))return [[{Fee_Percentage:10,Platform_Fee_RS:15,Platform_Fee_Is_Percentage:1}]];return [{}];}};
 return {calls,pool};
}
test('setup defaults to read-only and never changes fare data or ledger balances',async()=>{
 const f=fixture(['Fee_Percentage']);const result=await configure(f.pool);assert.equal(result.read_only,true);assert.equal(f.calls.length,1);
});
test('setup adds the single fee-mode bit and preserves an existing fixed-fee column',async()=>{
 const f=fixture(['Fee_Percentage','Platform_Fee_RS']);const result=await configure(f.pool,{apply:true});
 assert.equal(result.existing_wallets_changed,false);const alter=f.calls.filter(sql=>sql.startsWith('ALTER'));assert.equal(alter.length,1);assert.match(alter[0],/Platform_Fee_Is_Percentage.*DEFAULT 1/);assert.equal(f.calls.some(sql=>/^(UPDATE|DELETE|INSERT)/.test(sql)),false);
 const configured=fixture(['Fee_Percentage','Platform_Fee_RS','Platform_Fee_Is_Percentage']);await configure(configured.pool,{apply:true});assert.equal(configured.calls.some(sql=>sql.startsWith('ALTER')),false);
});
