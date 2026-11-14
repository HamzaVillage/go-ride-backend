const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Load the actual router/controller, with infrastructure replaced before imports.
// No live DB, socket server, Firebase or background jobs are started.
let queries = [], failRead = false, released = 0;
const rows = [{ Ride_ID_Pk: 9, Fare: 500, Customer_Payable: 350 }];
const connection = {
  async query(sql, args) {
    queries.push({ sql, args });
    if (failRead) throw new Error('Fixture database unavailable');
    if (sql.includes('FROM drivers')) return [[]];
    return [rows];
  },
  release() { released++; },
};
for (const [id, value] of [
  ['../db/Connect_Db', { getConnection: async () => connection }],
  ['../socket/socketManager', { getIO() { throw new Error('No live socket'); } }],
  ['../services/pushNotificationService', {}],
  ['../services/redisCache', {cache:{}}],
]) {
  const filename = require.resolve(id);
  const mock = new Module(filename);
  mock.exports = value;
  mock.loaded = true;
  require.cache[filename] = mock;
}
let router;
test('actual ride router loads and every registered handler is callable', () => {
  router = require('../routers/ride');
  assert.ok(router.stack.length > 20);
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const handler of layer.route.stack)
      assert.equal(typeof handler.handle, 'function', layer.route.path);
  }
  assert.ok(router.stack.some(layer => layer.route?.path === '/history'));
});
async function history() {
  const handler = router.stack.find(layer => layer.route?.path === '/history').route.stack.at(-1).handle;
  const res = { statusCode:200, status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;} };
  await handler({ user:{userId:42,role:'rider',phone:'03000000000'},query:{role:'rider',status:'Completed,Cancelled',limit:'10',offset:'0'} },res);
  return res;
}
test('restored history is scoped to the rider and returns discount fields', async () => {
  queries=[];
  const res=await history();
  assert.equal(res.statusCode,200);
  assert.equal(res.body.data[0].Customer_Payable,350);
  const read=queries.find(q=>q.sql.includes('FROM ride_history'));
  assert.match(read.sql,/WHERE User_ID_Fk = \?/);
  assert.deepEqual(read.args,[42,'Completed','Cancelled',10,0]);
  assert.equal(released,1);
});
test('history read failure returns an error and releases the connection',async()=>{
  failRead=true;
  const oldError=console.error;console.error=()=>{};
  try {const res=await history();assert.equal(res.statusCode,500);assert.equal(res.body.success,false);assert.equal(released,2);}
  finally {console.error=oldError;failRead=false;}
});
