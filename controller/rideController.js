const pool = require('../db/Connect_Db');

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

            const [rides] = await conn.query("SELECT Ride_Status, Driver_ID_Fk FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
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
    }
};

module.exports = rideController;

