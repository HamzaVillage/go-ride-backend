const pool = require('../db/Connect_Db');
const { getIO } = require('../socket/socketManager');

const rideController = {
    createRide: async (req, res) => {
        const {
            user_id, pickup_location, drop_location, pickup_lat, pickup_lng,
            drop_lat, drop_lng, distance, duration, fare, base_fare,
            per_km_rate, night_charge, peak_hour_surcharge, total_waiting_time,
            waiting_charges, is_peak_hour, is_night_ride, payment_method,
            vehicle_type, ride_date, start_time
        } = req.body;

        if (!user_id || !pickup_location || !drop_location || !pickup_lat || !pickup_lng) {
            return res.status(400).json({ success: false, message: "Missing required fields for ride creation" });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            const [result] = await conn.query(
                `INSERT INTO ride_history (
                    User_ID_Fk, Pickup_Location, Drop_Location, Pickup_Lat, Pickup_Lng, 
                    Drop_Lat, Drop_Lng, Distance, Duration, Fare, Base_Fare, 
                    Per_Km_Rate, Night_Charge, Peak_Hour_Surcharge, Total_Waiting_Time, 
                    Waiting_Charges, Is_Peak_Hour, Is_Night_Ride, Payment_Method, 
                    Vehicle_Type, Ride_Status, Ride_Date, Start_Time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user_id, pickup_location, drop_location, pickup_lat, pickup_lng,
                    drop_lat, drop_lng, distance, duration, fare, base_fare,
                    per_km_rate, night_charge, peak_hour_surcharge, total_waiting_time,
                    waiting_charges, is_peak_hour ? 1 : 0, is_night_ride ? 1 : 0, payment_method,
                    vehicle_type, 'Requested', ride_date || new Date(), start_time || new Date()
                ]
            );

            // Emit socket event to drivers with matching vehicle type
            try {
                const io = getIO();
                const [newRide] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [result.insertId]);
                io.to(`vehicle:${vehicle_type}`).emit("new_ride_request", {
                    ride_id: result.insertId,
                    ride: newRide[0]
                });
            } catch (socketErr) {
                console.error("Socket emit error (non-blocking):", socketErr.message);
            }

            res.status(201).json({
                success: true,
                message: "Ride created successfully",
                rideId: result.insertId
            });
        } catch (err) {
            console.error("Create Ride Error:", err);
            res.status(500).json({ success: false, message: "Error creating ride", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getNearbyRides: async (req, res) => {
        const { driver_lat, driver_lng, driver_id } = req.query;

        if (!driver_lat || !driver_lng || !driver_id) {
            return res.status(400).json({ success: false, message: "Driver location (lat/lng) and Driver ID are required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // 1. Fetch driver's vehicle type
            const [driverRows] = await conn.query("SELECT vehicle_type FROM drivers WHERE id = ?", [driver_id]);
            if (driverRows.length === 0) {
                return res.status(404).json({ success: false, message: "Driver not found" });
            }
            const driverVehicleType = driverRows[0].vehicle_type;

            // 2. Haversine formula to find rides within 1km where Driver_ID_Fk IS NULL and Vehicle_Type matches
            const query = `
                SELECT *, 
                (6371 * acos(cos(radians(?)) * cos(radians(Pickup_Lat)) * cos(radians(Pickup_Lng) - radians(?)) + sin(radians(?)) * sin(radians(Pickup_Lat)))) AS distance_km
                FROM ride_history
                WHERE Driver_ID_Fk IS NULL 
                AND Ride_Status = 'Requested'
                AND Vehicle_Type = ?
                HAVING distance_km < 1
                ORDER BY distance_km ASC
            `;

            const [rides] = await conn.query(query, [driver_lat, driver_lng, driver_lat, driverVehicleType]);

            res.json({
                success: true,
                count: rides.length,
                driver_vehicle_type: driverVehicleType,
                data: rides
            });
        } catch (err) {
            console.error("Get Nearby Rides Error:", err);
            res.status(500).json({ success: false, message: "Error fetching nearby rides", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    acceptRide: async (req, res) => {
        const { ride_id, driver_id } = req.body;

        if (!ride_id || !driver_id) {
            return res.status(400).json({ success: false, message: "Ride ID and Driver ID are required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // 1. Validate that the ride exists and is still in 'Requested' status
            const [rides] = await conn.query(
                "SELECT Ride_Status, Driver_ID_Fk FROM ride_history WHERE Ride_ID_Pk = ?",
                [ride_id]
            );

            if (rides.length === 0) {
                return res.status(404).json({ success: false, message: "Ride request not found" });
            }

            const ride = rides[0];
            if (ride.Ride_Status !== 'Requested' || ride.Driver_ID_Fk !== null) {
                return res.status(400).json({ success: false, message: "This ride is no longer available" });
            }

            // 2. Update ride_history to assign driver and change status
            await conn.query(
                "UPDATE ride_history SET Driver_ID_Fk = ?, Ride_Status = 'Accepted' WHERE Ride_ID_Pk = ?",
                [driver_id, ride_id]
            );

            // Fetch the full ride to get the rider's user ID and notify them
            const [updatedRide] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
            try {
                const io = getIO();
                // Notify the rider that their ride was accepted
                io.to(`user:${updatedRide[0].User_ID_Fk}`).emit("ride_accepted", {
                    ride_id,
                    driver_id,
                    ride: updatedRide[0]
                });
                // Notify other drivers that ride is no longer available
                io.to(`vehicle:${updatedRide[0].Vehicle_Type}`).emit("ride_unavailable", {
                    ride_id
                });
            } catch (socketErr) {
                console.error("Socket emit error (non-blocking):", socketErr.message);
            }

            res.json({ success: true, message: "Ride accepted successfully" });
        } catch (err) {
            console.error("Accept Ride Error:", err);
            res.status(500).json({ success: false, message: "Error accepting ride", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    cancelRide: async (req, res) => {
        const { ride_id, reason } = req.body;
        const user = req.user; // from authMiddleware

        if (!ride_id || !reason) {
            return res.status(400).json({ success: false, message: "Ride ID and reason are required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const [rides] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
            if (rides.length === 0) {
                return res.status(404).json({ success: false, message: "Ride not found" });
            }

            const ride = rides[0];
            if (ride.Ride_Status === 'Completed' || ride.Ride_Status === 'Cancelled') {
                return res.status(400).json({ success: false, message: `Ride is already ${ride.Ride_Status}` });
            }

            const cancelled_by = user.role === 'driver' ? 'Driver' : 'User';

            await conn.query(
                "UPDATE ride_history SET Ride_Status = 'Cancelled', Cancelled_By = ?, Cancellation_Reason = ? WHERE Ride_ID_Pk = ?",
                [cancelled_by, reason, ride_id]
            );

            // Emit cancellation notification
            try {
                const io = getIO();
                const cancelPayload = { ride_id, cancelled_by, reason, ride };
                if (cancelled_by === 'Driver' && ride.User_ID_Fk) {
                    // Driver cancelled → notify rider
                    io.to(`user:${ride.User_ID_Fk}`).emit("ride_cancelled", cancelPayload);
                } else if (cancelled_by === 'User') {
                    if (ride.Driver_ID_Fk) {
                        // Rider cancelled after acceptance → notify driver via phone lookup
                        const [driverRows] = await conn.query("SELECT phone FROM drivers WHERE id = ?", [ride.Driver_ID_Fk]);
                        if (driverRows.length > 0) {
                            const [userRows] = await conn.query("SELECT User_ID_Pk FROM users WHERE Mobile = ?", [driverRows[0].phone]);
                            if (userRows.length > 0) {
                                io.to(`user:${userRows[0].User_ID_Pk}`).emit("ride_cancelled", cancelPayload);
                            }
                        }
                    } else {
                        // Rider abandoned before acceptance → notify drivers in vehicle room
                        io.to(`vehicle:${ride.Vehicle_Type}`).emit("ride_unavailable", { ride_id });
                    }
                }
            } catch (socketErr) {
                console.error("Socket emit error (non-blocking):", socketErr.message);
            }

            res.json({ success: true, message: "Ride cancelled successfully" });
        } catch (err) {
            console.error("Cancel Ride Error:", err);
            res.status(500).json({ success: false, message: "Error cancelling ride", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    completeRide: async (req, res) => {
        const { ride_id } = req.body;

        if (!ride_id) {
            return res.status(400).json({ success: false, message: "Ride ID is required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const [rides] = await conn.query("SELECT Ride_Status FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
            if (rides.length === 0) {
                return res.status(404).json({ success: false, message: "Ride not found" });
            }

            if (rides[0].Ride_Status !== 'Accepted') {
                return res.status(400).json({ success: false, message: "Only accepted rides can be completed" });
            }

            await conn.query(
                "UPDATE ride_history SET Ride_Status = 'Completed', End_Time = NOW() WHERE Ride_ID_Pk = ?",
                [ride_id]
            );

            // Notify rider that ride is completed
            const [completedRide] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
            try {
                const io = getIO();
                io.to(`user:${completedRide[0].User_ID_Fk}`).emit("ride_completed", {
                    ride_id,
                    ride: completedRide[0]
                });
            } catch (socketErr) {
                console.error("Socket emit error (non-blocking):", socketErr.message);
            }

            res.json({ success: true, message: "Ride completed successfully" });
        } catch (err) {
            console.error("Complete Ride Error:", err);
            res.status(500).json({ success: false, message: "Error completing ride", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    startRide: async (req, res) => {
        const { ride_id } = req.body;
        const user = req.user;

        if (!ride_id) {
            return res.status(400).json({ success: false, message: "Ride ID is required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const [rides] = await conn.query("SELECT Ride_Status, Driver_ID_Fk, User_ID_Fk FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
            if (rides.length === 0) {
                return res.status(404).json({ success: false, message: "Ride not found" });
            }

            const ride = rides[0];
            if (ride.Ride_Status !== 'Accepted') {
                return res.status(400).json({ success: false, message: `Ride must be 'Accepted' to start (Current: ${ride.Ride_Status})` });
            }

            // Verify it's the right driver
            const [driverRows] = await conn.query("SELECT id FROM drivers WHERE phone = ?", [user.phone]);
            if (driverRows.length === 0 || driverRows[0].id !== ride.Driver_ID_Fk) {
                return res.status(403).json({ success: false, message: "Only the assigned driver can start this ride" });
            }

            await conn.query(
                "UPDATE ride_history SET Ride_Status = 'Ongoing', Ride_Date = NOW() WHERE Ride_ID_Pk = ?",
                [ride_id]
            );

            // Notify rider that ride has started
            try {
                const io = getIO();
                io.to(`user:${ride.User_ID_Fk || ''}`).emit("ride_started", { ride_id });
            } catch (socketErr) {
                console.error("Socket emit error (non-blocking):", socketErr.message);
            }

            res.json({ success: true, message: "Ride started successfully" });
        } catch (err) {
            console.error("Start Ride Error:", err);
            res.status(500).json({ success: false, message: "Error starting ride", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    updateFare: async (req, res) => {
        const {
            ride_id, fare, base_fare, per_km_rate,
            night_charge, peak_hour_surcharge, waiting_charges
        } = req.body;
        const user = req.user;

        if (!ride_id || fare === undefined) {
            return res.status(400).json({ success: false, message: "Ride ID and new fare are required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const [rides] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
            if (rides.length === 0) {
                return res.status(404).json({ success: false, message: "Ride not found" });
            }

            const ride = rides[0];
            if (ride.User_ID_Fk !== user.userId) {
                return res.status(403).json({ success: false, message: "You can only update fares for rides you created" });
            }

            if (ride.Ride_Status !== 'Requested') {
                return res.status(400).json({ success: false, message: "Fare can only be updated for 'Requested' rides" });
            }

            await conn.query(
                `UPDATE ride_history SET 
                    Fare = ?, Base_Fare = ?, Per_Km_Rate = ?, 
                    Night_Charge = ?, Peak_Hour_Surcharge = ?, 
                    Waiting_Charges = ? 
                WHERE Ride_ID_Pk = ?`,
                [
                    fare,
                    base_fare || ride.Base_Fare,
                    per_km_rate || ride.Per_Km_Rate,
                    night_charge || ride.Night_Charge,
                    peak_hour_surcharge || ride.Peak_Hour_Surcharge,
                    waiting_charges || ride.Waiting_Charges,
                    ride_id
                ]
            );

            // Notify drivers about fare update
            try {
                const io = getIO();
                const [updatedRide] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
                io.to(`vehicle:${ride.Vehicle_Type}`).emit("fare_updated", {
                    ride_id,
                    new_fare: fare,
                    ride: updatedRide[0]
                });
            } catch (socketErr) {
                console.error("Socket emit error (non-blocking):", socketErr.message);
            }

            res.json({ success: true, message: "Ride fare updated successfully" });
        } catch (err) {
            console.error("Update Fare Error:", err);
            res.status(500).json({ success: false, message: "Error updating fare", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getRideHistory: async (req, res) => {
        const { status } = req.query;
        const user = req.user; // from authMiddleware

        let conn;
        try {
            conn = await pool.getConnection();

            let query = "SELECT * FROM ride_history WHERE ";
            let queryParams = [];

            if (user.role === 'driver') {
                // Fetch driver's actual id first
                const [driverRows] = await conn.query("SELECT id FROM drivers WHERE phone = ?", [user.phone]);
                if (driverRows.length === 0) {
                    return res.status(404).json({ success: false, message: "Driver profile not found" });
                }
                query += "Driver_ID_Fk = ? ";
                queryParams.push(driverRows[0].id);
            } else {
                query += "User_ID_Fk = ? ";
                queryParams.push(user.userId);
            }

            if (status) {
                query += "AND Ride_Status = ? ";
                queryParams.push(status);
            }

            query += "ORDER BY CreatedAt DESC";

            const [rides] = await conn.query(query, queryParams);

            res.json({ success: true, count: rides.length, data: rides });
        } catch (err) {
            console.error("Get Ride History Error:", err);
            res.status(500).json({ success: false, message: "Error fetching ride history", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getRecentAddresses: async (req, res) => {
        const user = req.user;

        let conn;
        try {
            conn = await pool.getConnection();

            // Get unique drop-off locations from last 50 rides
            const [rows] = await conn.query(
                `SELECT DISTINCT Drop_Location as address, Drop_Lat as latitude, Drop_Lng as longitude 
                 FROM ride_history 
                 WHERE User_ID_Fk = ? 
                 AND Ride_Status = 'Completed'
                 ORDER BY End_Time DESC 
                 LIMIT 10`,
                [user.userId]
            );

            res.json({ success: true, count: rows.length, data: rows });
        } catch (err) {
            console.error("Get Recent Addresses Error:", err);
            res.status(500).json({ success: false, message: "Error fetching recent addresses", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = rideController;

