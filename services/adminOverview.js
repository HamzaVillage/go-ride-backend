const DAY_MS = 86400000;
const PAKISTAN_OFFSET_MS = 5 * 60 * 60 * 1000;
const RIDER_ROLES = "('rider', 'user', 'customer', '')";
function overviewRange(days = '7', now = Date.now()) {
    if (!['1', '7', '30'].includes(String(days)) || !['number', 'string'].includes(typeof days)) {
        throw Object.assign(new Error('Reporting days must be 1, 7, or 30.'), {status:400});
    }
    const today = new Date(now + PAKISTAN_OFFSET_MS).toISOString().slice(0,10);
    const endMs = Date.parse(`${today}T00:00:00.000Z`) + DAY_MS - PAKISTAN_OFFSET_MS;
    const startMs = endMs - Number(days) * DAY_MS;
    return { days:Number(days), timezone:'Asia/Karachi', startDate:new Date(startMs+PAKISTAN_OFFSET_MS).toISOString().slice(0,10), endDate:today,
        startSeconds:startMs/1000, endSeconds:endMs/1000, firstDayIndex:Math.floor((startMs+PAKISTAN_OFFSET_MS)/DAY_MS) };
}
const number = value => Number(value || 0);
function createAdminOverviewService(pool, {now = () => Date.now()} = {}) {
    return {async get(query = {}) {
        const generatedAt = now(); const range = overviewRange(query.days,generatedAt); let conn; let started=false;
        try {
            conn = await pool.getConnection();
            // One read-only snapshot keeps cards, graphs and latest rides mutually consistent.
            await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
            await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'); started=true;
            const [accounts] = await conn.query(`SELECT COUNT(*) AS total_users,
                COALESCE(SUM(LOWER(TRIM(COALESCE(Role, ''))) IN ${RIDER_ROLES}),0) AS total_riders
                FROM users WHERE COALESCE(AccountDeleted, 0) = 0`);
            const [fleetRows] = await conn.query(`SELECT LOWER(TRIM(COALESCE(status,'unknown'))) AS status,
                COUNT(*) AS count, COALESCE(SUM(CASE WHEN LOWER(TRIM(status)) = 'active' AND Is_Online = 1 THEN 1 ELSE 0 END),0) AS online
                FROM drivers GROUP BY LOWER(TRIM(COALESCE(status,'unknown')))`);
            const [cities] = await conn.query(`SELECT COALESCE(NULLIF(TRIM(city),''),'Unknown') AS city, COUNT(*) AS count
                FROM drivers GROUP BY COALESCE(NULLIF(TRIM(city),''),'Unknown') ORDER BY count DESC, city ASC`);
            const period = 'WHERE Ride_Date >= FROM_UNIXTIME(?) AND Ride_Date < FROM_UNIXTIME(?)';
            const params = [range.startSeconds,range.endSeconds];
            const [statuses] = await conn.query(`SELECT LOWER(TRIM(COALESCE(Ride_Status,'unknown'))) AS status, COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN LOWER(TRIM(Ride_Status)) = 'completed' THEN Fare ELSE 0 END),0) AS gross_fare,
                COALESCE(SUM(CASE WHEN LOWER(TRIM(Ride_Status)) = 'completed' THEN Organization_Fee ELSE 0 END),0) AS platform_fees
                FROM ride_history ${period} GROUP BY LOWER(TRIM(COALESCE(Ride_Status,'unknown')))`,params);
            const [dailyRows] = await conn.query(`SELECT FLOOR((UNIX_TIMESTAMP(Ride_Date) + 18000) / 86400) AS day_index,
                COUNT(*) AS total, COALESCE(SUM(LOWER(TRIM(Ride_Status)) = 'completed'),0) AS completed,
                COALESCE(SUM(LOWER(TRIM(Ride_Status)) = 'cancelled'),0) AS cancelled,
                COALESCE(SUM(CASE WHEN LOWER(TRIM(Ride_Status)) = 'completed' THEN Fare ELSE 0 END),0) AS gross_fare,
                COALESCE(SUM(CASE WHEN LOWER(TRIM(Ride_Status)) = 'completed' THEN Organization_Fee ELSE 0 END),0) AS platform_fees
                FROM ride_history ${period} GROUP BY day_index ORDER BY day_index`,params);
            const [recent] = await conn.query(`SELECT r.Ride_ID_Pk AS ride_id, u.User_Name AS rider, d.full_name AS driver,
                r.Pickup_Location AS pickup, r.Drop_Location AS destination, r.Fare AS fare, r.Ride_Status AS status,
                UNIX_TIMESTAMP(r.Ride_Date) * 1000 AS ride_at
                FROM ride_history r LEFT JOIN users u ON u.User_ID_Pk = r.User_ID_Fk LEFT JOIN drivers d ON d.id = r.Driver_ID_Fk
                WHERE r.Ride_Date >= FROM_UNIXTIME(?) AND r.Ride_Date < FROM_UNIXTIME(?)
                ORDER BY r.Ride_Date DESC, r.Ride_ID_Pk DESC LIMIT 8`,params);
            await conn.commit(); started=false;
            const driverStatuses = Object.fromEntries(fleetRows.map(row=>[row.status,number(row.count)]));
            const rideStatuses = Object.fromEntries(statuses.map(row=>[row.status,number(row.count)]));
            const totalDrivers = fleetRows.reduce((sum,row)=>sum+number(row.count),0);
            const totalRides = statuses.reduce((sum,row)=>sum+number(row.count),0);
            const dayMap = new Map(dailyRows.map(row=>[number(row.day_index),row]));
            const daily = Array.from({length:range.days},(_,index)=>{
                const row=dayMap.get(range.firstDayIndex+index)||{};
                return {date:new Date((range.firstDayIndex+index)*DAY_MS).toISOString().slice(0,10),total:number(row.total),completed:number(row.completed),cancelled:number(row.cancelled),gross_fare:number(row.gross_fare),platform_fees:number(row.platform_fees)};
            });
            return {
                range:{days:range.days,timezone:range.timezone,startDate:range.startDate,endDate:range.endDate},generated_at:new Date(generatedAt).toISOString(),
                accounts:{total_users:number(accounts[0]?.total_users),total_riders:number(accounts[0]?.total_riders),total_drivers:totalDrivers,
                    online_drivers:fleetRows.reduce((sum,row)=>sum+number(row.online),0),pending_drivers:number(driverStatuses.pending)+number(driverStatuses.unverified),driver_statuses:driverStatuses},
                rides:{total:totalRides,completed:number(rideStatuses.completed),cancelled:number(rideStatuses.cancelled),
                    completion_rate:totalRides?Number((number(rideStatuses.completed)/totalRides*100).toFixed(1)):0,
                    gross_fare:statuses.reduce((sum,row)=>sum+number(row.gross_fare),0),platform_fees:statuses.reduce((sum,row)=>sum+number(row.platform_fees),0),statuses:rideStatuses},
                daily,driver_cities:cities.map(row=>({city:row.city,count:number(row.count),percentage:totalDrivers?Number((number(row.count)/totalDrivers*100).toFixed(1)):0})),
                recent_rides:recent.map(row=>({...row,id:`GR-${row.ride_id}`,rider:row.rider||'Unavailable rider',driver:row.driver||'Not assigned',fare:number(row.fare),ride_at:number(row.ride_at)})),
            };
        } catch(error){if(started){try{await conn.rollback();}catch{ /* Preserve the query failure. */ }}throw error;}
        finally{if(conn)conn.release();}
    }};
}
module.exports = {createAdminOverviewService, overviewRange};
