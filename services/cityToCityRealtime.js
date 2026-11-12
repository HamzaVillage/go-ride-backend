const {resolveCityToCityIdentity}=require('./cityToCityIdentity');
function registerCityToCityRealtime(socket,pool){
 let joining=false;
 socket.on('c2c:subscribe',async (_data,reply)=>{
  const ack=typeof reply==='function'?reply:()=>{};
  if(joining)return ack({success:false});joining=true;
  try{
   const owner=await resolveCityToCityIdentity(pool,socket.user);
   if(!socket.connected)return;
   for(const room of socket.rooms)if(room.startsWith('c2c:'))await socket.leave(room);
   await socket.join(`c2c:user:${owner.userId}`);
   const [rows]=await pool.query("SELECT current_city_id FROM city_to_city_drivers WHERE user_id=? AND application_status='approved' AND is_online=1 AND presence_updated_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 90 SECOND)",[owner.userId]);
   if(socket.connected&&rows[0]?.current_city_id)await socket.join(`c2c:city:${rows[0].current_city_id}`);
   ack({success:true});
  }catch(error){ack({success:false,message:error.status?error.message:'Unable to connect city-to-city updates.'});}
  finally{joining=false;}
 });
 socket.on('c2c:unsubscribe',async()=>{for(const room of socket.rooms)if(room.startsWith('c2c:'))await socket.leave(room);});
}
async function publishRequest(pool,requestId,{getIO=()=>require('../socket/socketManager').getIO()}={}){
 try{
  const [rows]=await pool.query('SELECT r.id,r.origin_city_id,r.customer_user_id,d.user_id AS driver_user_id FROM city_to_city_requests r LEFT JOIN city_to_city_dispatch a ON a.request_id=r.id LEFT JOIN city_to_city_drivers d ON d.id=a.city_to_city_driver_id WHERE r.id=?',[requestId]);
  if(!rows[0])return;const r=rows[0],io=getIO();
  // Invalidation only: names/phones/addresses never enter a city broadcast.
  const rooms=[`c2c:city:${r.origin_city_id}`,`c2c:user:${r.customer_user_id}`];
  if(r.driver_user_id)rooms.push(`c2c:user:${r.driver_user_id}`);
  io.to(rooms).emit('c2c:changed',{request_id:r.id});
 }catch(error){console.warn('City-to-city realtime update unavailable:',error.code||'SOCKET_UNAVAILABLE');}
}
async function publishTrip(pool,tripId){
 try{const [rows]=await pool.query('SELECT request_id FROM city_to_city_dispatch WHERE trip_id=?',[tripId]);if(rows[0])await publishRequest(pool,rows[0].request_id);}catch(error){console.warn('City-to-city trip update unavailable:',error.code||'SOCKET_UNAVAILABLE');}
}
module.exports={registerCityToCityRealtime,publishRequest,publishTrip};
