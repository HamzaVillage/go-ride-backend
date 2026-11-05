const { getSearchConfig, getSearchState, dispatchRide } = require('./driverDispatch');

// The conditional write races safely with the acceptance transaction's ride lock.
// Reuse the existing System cancellation outcome instead of changing the status enum.
async function expireSearch(conn, io, ride, search) {
    if (!search.exhausted || ride.Ride_Status !== 'Requested') return false;
    const [result] = await conn.query(
        `UPDATE ride_history SET Ride_Status = 'Cancelled', Cancelled_By = 'System',
         Cancellation_Reason = 'NO_DRIVER_AVAILABLE'
         WHERE Ride_ID_Pk = ? AND Ride_Status = 'Requested' AND Driver_ID_Fk IS NULL
           AND TIMESTAMPDIFF(SECOND, CreatedAt, NOW()) >= ?`,
        [ride.Ride_ID_Pk, search.duration_seconds]
    );
    if (result.affectedRows !== 1) {
        const [rows] = await conn.query(
            'SELECT Ride_Status, Cancellation_Reason FROM ride_history WHERE Ride_ID_Pk = ?', [ride.Ride_ID_Pk]
        );
        if (rows[0]) Object.assign(ride, rows[0]);
        return false;
    }
    ride.Ride_Status = 'Cancelled';
    ride.Cancellation_Reason = 'NO_DRIVER_AVAILABLE';
    try {
        io.to(`user:${ride.User_ID_Fk}`).emit('ride_search_exhausted', { ride_id: ride.Ride_ID_Pk, message: 'No driver available. Please try again.' });
        io.to(`vehicle:${String(ride.Vehicle_Type).trim().toLowerCase()}`).emit('ride_unavailable', { ride_id: ride.Ride_ID_Pk });
    } catch (err) {
        // Polling/recovery can still see the persisted outcome after a delivery failure.
        console.error('Search exhaustion event failed:', err.message);
    }
    return true;
}

// Age comes from MySQL CreatedAt/NOW(), so search deadlines survive server restarts
// and do not depend on the rider keeping their app open.
async function tickSearches(conn, io, state) {
    const config = await getSearchConfig(conn);
    const [rides] = await conn.query(
        `SELECT r.*, r.User_ID_FK AS User_ID_Fk, u.User_Name AS rider_name, TIMESTAMPDIFF(SECOND, r.CreatedAt, NOW()) AS Search_Age_Seconds
         FROM ride_history r LEFT JOIN users u ON u.User_ID_Pk = r.User_ID_Fk
         WHERE r.Ride_Status = 'Requested' AND r.Driver_ID_Fk IS NULL AND r.Ride_ID_Pk > ?
         ORDER BY r.Ride_ID_Pk LIMIT 100`, [state.cursor]
    );
    state.cursor = rides.length === 100 ? rides[rides.length - 1].Ride_ID_Pk : 0;
    const now = Date.now();
    for (const [id, previous] of state.stages) if (now - previous.seenAt > 600000) state.stages.delete(id);
    for (const ride of rides) {
        try {
            const search = getSearchState(ride, config);
            if (search.exhausted) {
                await expireSearch(conn, io, ride, search);
                state.stages.delete(ride.Ride_ID_Pk);
                continue;
            }
            const previous = state.stages.get(ride.Ride_ID_Pk);
            if (!previous || previous.radius !== search.radius_km) {
                await dispatchRide(io, conn, ride, 'new_ride_request', { ride_id: ride.Ride_ID_Pk, ride }, config);
            }
            state.stages.set(ride.Ride_ID_Pk, { radius: search.radius_km, seenAt: now });
        } catch (err) {
            console.error('Ride search tick failed:', ride.Ride_ID_Pk, err.message);
        }
    }
}

function startRideSearchWorker(pool, io) {
    const state = { cursor: 0, stages: new Map() };
    let stopped = false;
    let timer;
    async function run() {
        let conn;
        try {
            conn = await pool.getConnection();
            await tickSearches(conn, io, state);
        } catch (err) {
            console.error('Ride search worker failed:', err.message);
        } finally {
            if (conn) conn.release();
            if (!stopped) {
                timer = setTimeout(run, 2000);
                timer.unref();
            }
        }
    }
    timer = setTimeout(run, 0);
    timer.unref();
    return () => { stopped = true; clearTimeout(timer); };
}

module.exports = { expireSearch, tickSearches, startRideSearchWorker };
