const axios=require('axios');
const {fail}=require('./cityToCityDrivers');
function coordinate(point){
 if(!point || point.latitude==null || point.longitude==null || !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude)) || Math.abs(Number(point.latitude))>90 || Math.abs(Number(point.longitude))>180)throw fail(400,'Choose a valid location.');
 return {latitude:Number(point.latitude),longitude:Number(point.longitude)};
}
function createGeography(pool){
 const cityCache=new Map();
 const key=()=>{const value=process.env.GOOGLE_MAPS_API_KEY;if(!value)throw fail(503,'City location lookup is not configured.');return value;};
 return {
  async city(point){
   point=coordinate(point);
   const cacheKey=`${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
   const cached=cityCache.get(cacheKey);if(cached&&cached.until>Date.now())return cached.city;
   const {data}=await axios.get('https://maps.googleapis.com/maps/api/geocode/json',{params:{latlng:`${point.latitude},${point.longitude}`,key:key(),language:'en'},timeout:10000});
   if(data.status!=='OK')throw fail(503,'Unable to verify your current city. Please try again.');
   const components=data.results.flatMap(row=>row.address_components || []);
   if(!components.some(c=>c.types.includes('country')&&c.short_name==='PK'))throw fail(400,'City-to-city service is available in Pakistan only.');
   const names=[...new Set(components.filter(c=>c.types.includes('locality')||c.types.includes('postal_town')).map(c=>c.long_name.trim().toLowerCase()))];
   if(!names.length)throw fail(400,'Unable to identify this city. Choose a location inside a supported city.');
   const [cities]=await pool.query(`SELECT ID_PK,City_Name FROM city WHERE LOWER(TRIM(City_Name)) IN (${names.map(()=>'?').join(',')})`,names);
   if(cities.length!==1)throw fail(400,'This city is unavailable or ambiguous. Choose a location in a supported city.');
   const city={id:Number(cities[0].ID_PK),name:cities[0].City_Name};
   if(cityCache.size>1000)cityCache.clear();cityCache.set(cacheKey,{city,until:Date.now()+30000});return city;
  },
  async route(from,to){
   from=coordinate(from);to=coordinate(to);
   const {data}=await axios.get('https://maps.googleapis.com/maps/api/directions/json',{params:{origin:`${from.latitude},${from.longitude}`,destination:`${to.latitude},${to.longitude}`,key:key()},timeout:15000});
   const leg=data.routes?.[0]?.legs?.[0];if(data.status!=='OK'||!leg)throw fail(503,'Unable to calculate the city-to-city route.');
   return {km:leg.distance.value/1000,minutes:Math.ceil(leg.duration.value/60)};
  }
 };
}
module.exports={createGeography,coordinate};
