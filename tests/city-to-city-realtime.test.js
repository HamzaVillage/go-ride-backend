const test=require('node:test');const assert=require('node:assert/strict');
const {registerCityToCityRealtime,publishRequest}=require('../services/cityToCityRealtime');
function fixture({approved=true}={}){
 const handlers={},rooms=new Set(['socket-id','c2c:city:99']);const socket={user:{userId:7,role:'rider'},connected:true,rooms,on(event,fn){handlers[event]=fn;},async join(room){rooms.add(room);},async leave(room){rooms.delete(room);}};
 const pool={getConnection:async()=>({release(){},query:async()=>[[{User_ID_Pk:7,Mobile:'03001234567',Role:'rider',AccountDeleted:0}]]}),query:async(sql,args)=>{assert.match(sql,/application_status='approved'/);assert.match(sql,/is_online=1/);assert.match(sql,/90 SECOND/);assert.deepEqual(args,[7]);return [approved?[{current_city_id:1}]:[]];}};
 registerCityToCityRealtime(socket,pool);return {socket,handlers,pool};
}
test('city subscriptions use authenticated identity and live city presence, never caller city ID',async()=>{
 const f=fixture();let ack;await f.handlers['c2c:subscribe']({city_id:999,userId:100},r=>ack=r);assert.equal(ack.success,true);assert.ok(f.socket.rooms.has('c2c:user:7'));assert.ok(f.socket.rooms.has('c2c:city:1'));assert.equal(f.socket.rooms.has('c2c:city:99'),false);assert.equal(f.socket.rooms.has('c2c:city:999'),false);
 await f.handlers['c2c:unsubscribe']();assert.deepEqual([...f.socket.rooms],['socket-id']);
});
test('unapproved/offline users receive only their own customer updates',async()=>{
 const f=fixture({approved:false});await f.handlers['c2c:subscribe']({},()=>{});assert.deepEqual([...f.socket.rooms].sort(),['c2c:user:7','socket-id']);
});
test('post-commit broadcasts send only invalidation to origin-city and affected personal rooms',async()=>{
 let rooms,event,payload;await publishRequest({query:async()=>[[{id:9,origin_city_id:1,customer_user_id:55,driver_user_id:7}]]},9,{getIO:()=>({to(value){rooms=value;return {emit(e,p){event=e;payload=p;}};}})});
 assert.deepEqual(rooms,['c2c:city:1','c2c:user:55','c2c:user:7']);assert.equal(event,'c2c:changed');assert.deepEqual(payload,{request_id:9});
});

test('Socket.IO delivers city updates over the transport without waiting for polling',async t=>{
 const {createServer}=require('node:http'),{Server}=require('socket.io'),{once}=require('node:events');
 const {io:clientIO}=require('../'+ '../goRide/node_modules/socket.io-client');
 const server=createServer(),io=new Server(server);const f=fixture();
 io.on('connection',socket=>{socket.user={userId:7,role:'rider'};registerCityToCityRealtime(socket,f.pool);});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const client=clientIO(`http://127.0.0.1:${server.address().port}`,{transports:['websocket']});
 t.after(async()=>{client.disconnect();await new Promise(resolve=>io.close(resolve));});
 await once(client,'connect');
 const ack=await new Promise(resolve=>client.emit('c2c:subscribe',{city_id:999},resolve));assert.equal(ack.success,true);
 const received=once(client,'c2c:changed');
 await publishRequest({query:async()=>[[{id:9,origin_city_id:1,customer_user_id:55}]]},9,{getIO:()=>io});
 const [event]=await received;assert.deepEqual(event,{request_id:9});
});
