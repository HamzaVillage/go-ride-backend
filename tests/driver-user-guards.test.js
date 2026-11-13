const test=require('node:test'),assert=require('node:assert/strict');
const {configure}=require('../scripts/configureDriverUserLinks');
function fixture({orphan=false,existing=false}={}){const writes=[];return {writes,pool:{query:async sql=>{
 if(sql.includes('SELECT TABLE_NAME,ENGINE'))return [[{TABLE_NAME:'users',ENGINE:'InnoDB'},{TABLE_NAME:'drivers',ENGINE:'InnoDB'}]];
 if(sql.includes('SELECT d.id FROM drivers'))return [orphan?[{id:1}]:[]];
 if(sql.includes('information_schema.STATISTICS'))return [existing?[{INDEX_NAME:'already'}]:[]];
 if(sql.includes('KEY_COLUMN_USAGE'))return [existing?[{CONSTRAINT_NAME:'already'}]:[]];
 if(sql.includes('information_schema.TRIGGERS'))return [[{TRIGGER_NAME:'guard_driver_user_insert'},{TRIGGER_NAME:'guard_driver_user_update'}]];
 writes.push(sql);return [{}];
 }}};}
test('guard installer defaults to a read-only preflight and refuses orphaned links',async()=>{const f=fixture();assert.equal((await configure(f.pool)).read_only,true);assert.equal(f.writes.length,0);const bad=fixture({orphan:true});await assert.rejects(configure(bad.pool,{apply:true}),/orphan/);assert.equal(bad.writes.length,0);});
test('guard installation preserves old ownership and covers null, invalid and reused user IDs',async()=>{const f=fixture();assert.equal((await configure(f.pool,{apply:true})).guards_installed,true);assert.equal(f.writes.length,4);const sql=f.writes.join('\n');assert.match(sql,/ON DELETE RESTRICT ON UPDATE RESTRICT/);assert.match(sql,/BEFORE INSERT ON drivers/);assert.match(sql,/BEFORE UPDATE ON drivers/);assert.match(sql,/FOR UPDATE/);assert.match(sql,/DRIVER_USER_LINK_ALREADY_USED/);assert.doesNotMatch(sql,/UPDATE drivers SET|DELETE FROM|INSERT INTO users/);const ready=fixture({existing:true});await configure(ready.pool,{apply:true});assert.equal(ready.writes.length,2);});
