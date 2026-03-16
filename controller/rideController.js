const crypto = require('crypto');
const pool = require('../db/Connect_Db');
const { getIO } = require('../socket/socketManager');
const { notifyCustomer, notifyDriver } = require('../services/pushNotificationService');

const rideController = {
    createRide: async (req, res) => {
        const {
            pickup_location, drop_location, pickup_lat, pickup_lng,
            drop_lat, drop_lng, distance, duration, fare, base_fare,
            per_km_rate, night_charge, peak_hour_surcharge, total_waiting_time,
            waiting_charges, is_peak_hour, is_night_ride, payment_method,
            vehicle_type, ride_date, start_time
        } = req.body;

        // Always use the authenticated user's ID from JWT - never trust the body
        const user_id = req.user.userId;

        if (!user_id || !pickup_location || !drop_location || !pickup_lat || !pickup_lng) {
            return res.status(400).json({ success: false, message: "Missing required fields for ride creation" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const [activeRides] = await conn.query(
                "SELECT * FROM ride_history WHERE User_ID_Fk = ? AND Ride_Status IN ('Requested', 'Accepted', 'Arrived', 'Started', 'Ongoing')",
                [user_id]
            );

            if (activeRides.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "You already have an active ride. Please cancel or complete it before creating a new one.",
                    activeRideId: activeRides[0].Ride_ID_Pk
                });
            }

            // Fetch the fee percentage for the vehicle type
            const [rateRows] = await conn.query("SELECT Fee_Percentage FROM vehicle_fare_rate WHERE Vehicle_Type = ?", [vehicle_type]);
            const fee_percentage = rateRows.length > 0 ? parseFloat(rateRows[0].Fee_Percentage) : 0;

            // Calculate organization fee from the total fare
            // The fare passed from frontend already includes the fee
            const base_total_fare = parseFloat(fare) / (1 + fee_percentage / 100);
            const organization_fee = parseFloat(fare) - base_total_fare;

            const [result] = await conn.query(
                `INSERT INTO ride_history (
                    User_ID_Fk, Pickup_Location, Drop_Location, Pickup_Lat, Pickup_Lng, 
                    Drop_Lat, Drop_Lng, Distance, Duration, Fare, Base_Fare, 
                    Per_Km_Rate, Night_Charge, Peak_Hour_Surcharge, Total_Waiting_Time, 
                    Waiting_Charges, Is_Peak_Hour, Is_Night_Ride, Payment_Method, 
                    Vehicle_Type, Ride_Status, Ride_Date, Start_Time, Fee_Percentage, Organization_Fee
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user_id, pickup_location, drop_location, pickup_lat, pickup_lng,
                    drop_lat, drop_lng, distance, duration, fare, base_fare,
                    per_km_rate, night_charge, peak_hour_surcharge, total_waiting_time,
                    waiting_charges, is_peak_hour ? 1 : 0, is_night_ride ? 1 : 0, payment_method,
                    vehicle_type, 'Requested', ride_date || new Date(), start_time || new Date(),
                    fee_percentage, organization_fee
                ]
            );

            try {
                const io = getIO();
                const [newRide] = await conn.query(
                    `SELECT r.*, u.User_Name as rider_name 
                     FROM ride_history r 
                     LEFT JOIN users u ON r.User_ID_Fk = u.User_ID_Pk 
                     WHERE r.Ride_ID_Pk = ?`,
                    [result.insertId]
                );
                io.to(`vehicle:${vehicle_type.toLowerCase()}`).emit("new_ride_request", {
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
        const { driver_lat, driver_lng, vehicle_type } = req.query;
        const user = req.user;

        if (!driver_lat || !driver_lng) {
            return res.status(400).json({ success: false, message: "Driver location (lat/lng) is required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // Derive driver info from JWT for security
            const [driverRows] = await conn.query(
                "SELECT id, vehicle_type, overdue_since, completed_rides_count FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                [user.phone]
            );
            if (driverRows.length === 0) {
                return res.status(404).json({ success: false, message: "Driver profile not found" });
            }
            const driver = driverRows[0];
            const driverVehicleType = vehicle_type || driver.vehicle_type || 'Mini';

            const totalRides = parseInt(driver.completed_rides_count || 0, 10);
            let vehicleRidesLimit = 0;
            let vehicleRidesOverLimitCount = 0;
            if (driver.vehicle_type) {
                const [rateRows] = await conn.query(
                    "SELECT rides_limit, rides_over_limit_count FROM vehicle_fare_rate WHERE Vehicle_Type = ? AND Is_Active = 1 LIMIT 1",
                    [driver.vehicle_type]
                );
                vehicleRidesLimit = parseInt(rateRows[0]?.rides_limit ?? 0, 10);
                vehicleRidesOverLimitCount = parseInt(rateRows[0]?.rides_over_limit_count ?? 0, 10);
            }
            const ridesBeyondMax = vehicleRidesLimit > 0 ? Math.max(0, totalRides - vehicleRidesLimit) : 0;
            const meetsLimit = (vehicleRidesLimit > 0 && totalRides >= vehicleRidesLimit) ||
                (vehicleRidesOverLimitCount > 0 && ridesBeyondMax >= vehicleRidesOverLimitCount);

            if (meetsLimit) {
                if (!driver.overdue_since) {
                    await conn.query("UPDATE drivers SET overdue_since = NOW() WHERE id = ? AND overdue_since IS NULL", [driver.id]);
                }
                const [overdueCheck] = await conn.query(
                    "SELECT TIMESTAMPDIFF(HOUR, overdue_since, NOW()) as hours_overdue FROM drivers WHERE id = ?",
                    [driver.id]
                );
                const hoursOverdue = parseInt(overdueCheck[0]?.hours_overdue ?? 0, 10);
                if (hoursOverdue >= 8) {
                    return res.status(403).json({
                        success: false,
                        message: "Your account is blocked. Please clear your dues to continue finding rides.",
                        blocked: true
                    });
                }
            }

            const query = `
                SELECT r.*, u.User_Name as rider_name,
                (6371 * acos(cos(radians(?)) * cos(radians(Pickup_Lat)) * cos(radians(Pickup_Lng) - radians(?)) + sin(radians(?)) * sin(radians(Pickup_Lat)))) AS distance_km
                FROM ride_history r
                LEFT JOIN users u ON r.User_ID_Fk = u.User_ID_Pk
                WHERE r.Driver_ID_Fk IS NULL 
                AND r.Ride_Status = 'Requested'
                AND r.Vehicle_Type = ?
                HAVING distance_km < 50
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
        const { ride_id } = req.body;
        const user = req.user;

        if (!ride_id) {
            return res.status(400).json({ success: false, message: "Ride ID is required" });
        }

        const isDriver = user.role && String(user.role).toLowerCase() === 'driver';
        if (!isDriver) {
            return res.status(403).json({ success: false, message: "Only drivers can accept rides" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // Derive driver_id from JWT phone → drivers table (never trust client)
            const [driverRows] = await conn.query(
                "SELECT id, full_name, vehicle_type FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                [user.phone]
            );
            if (driverRows.length === 0) {
                return res.status(404).json({ success: false, message: "Driver profile not found. Please contact support." });
            }
            const driver_id = driverRows[0].id;

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

            await conn.query(
                "UPDATE ride_history SET Driver_ID_Fk = ?, Ride_Status = 'Accepted' WHERE Ride_ID_Pk = ?",
                [driver_id, ride_id]
            );

            const [updatedRide] = await conn.query(
                `SELECT r.*, d.full_name as driver_name, d.phone as driver_phone, 
                d.vehicle_type as driver_vehicle_type, d.vehicle_model, d.vehicle_number, 
                d.vehicle_color, d.photo_path as driver_photo, d.Rating as driver_rating,
                u.User_Name as rider_name
                FROM ride_history r
                LEFT JOIN drivers d ON r.Driver_ID_Fk = d.id
                LEFT JOIN users u ON r.User_ID_Fk = u.User_ID_Pk
                WHERE r.Ride_ID_Pk = ?`,
                [ride_id]
            );

            try {
                const io = getIO();
                const riderRoom = `user:${updatedRide[0].User_ID_Fk}`;
                const rideRoom = `ride:${ride_id}`;
                const vehicleRoom = `vehicle:${String(updatedRide[0].Vehicle_Type).toLowerCase()}`;

                const payload = { ride_id, driver_id, ride: updatedRide[0] };

                // Emit to rider's user room (rider is always in user:userId when connected)
                console.log(`📡 Emitting ride_accepted to ${riderRoom}`);
                io.to(riderRoom).emit("ride_accepted", payload);

                // Also emit to ride room (rider joins ride:rideId when they create the ride, so they receive here too)
                console.log(`📡 Emitting ride_accepted to ${rideRoom}`);
                io.to(rideRoom).emit("ride_accepted", payload);

                // Push notification to customer (await so send is attempted before response; errors must not affect ride flow)
                try { await notifyCustomer(updatedRide[0].User_ID_Fk, 'Ride accepted', 'Your driver is on the way.', { ride_id: String(ride_id), event: 'ride_accepted' }); } catch (e) { console.warn('Push notify error:', e?.message); }

                console.log(`📡 Emitting ride_unavailable to ${vehicleRoom}`);
                io.to(vehicleRoom).emit("ride_unavailable", {
                    ride_id
                });
            } catch (socketErr) {
                console.error("Socket emit error (non-blocking):", socketErr.message);
            }

            res.json({
                success: true,
                message: "Ride accepted successfully",
                ride: updatedRide[0]
            });
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

            const isDriverRole = user.role && String(user.role).toLowerCase() === 'driver';
            const cancelled_by = isDriverRole ? 'Driver' : 'User';

            await conn.query(
                "UPDATE ride_history SET Ride_Status = 'Cancelled', Cancelled_By = ?, Cancellation_Reason = ? WHERE Ride_ID_Pk = ?",
                [cancelled_by, reason, ride_id]
            );

            // Emit cancellation notification + push
            try {
                const io = getIO();
                const cancelPayload = { ride_id, cancelled_by, reason, ride };
                const pushData = { ride_id: String(ride_id), event: 'ride_cancelled' };
                if (cancelled_by === 'Driver' && ride.User_ID_Fk) {
                    // Driver cancelled → notify rider (socket + push)
                    io.to(`user:${ride.User_ID_Fk}`).emit("ride_cancelled", cancelPayload);
                    io.to(`ride:${ride_id}`).emit("ride_cancelled", cancelPayload);
                    try { await notifyCustomer(ride.User_ID_Fk, 'Ride cancelled', 'Your ride was cancelled.', pushData); } catch (e) { console.warn('Push notify error:', e?.message); }
                } else if (cancelled_by === 'User') {
                    if (ride.Driver_ID_Fk) {
                        io.to(`ride:${ride_id}`).emit("ride_cancelled", cancelPayload);
                        const [driverRows] = await conn.query("SELECT phone FROM drivers WHERE id = ?", [ride.Driver_ID_Fk]);
                        if (driverRows.length > 0) {
                            const [userRows] = await conn.query(
                                "SELECT User_ID_Pk FROM users WHERE REPLACE(Mobile, '-', '') = REPLACE(?, '-', '') AND Role IN ('driver', 'Driver')",
                                [driverRows[0].phone]
                            );
                            if (userRows.length > 0) {
                                io.to(`user:${userRows[0].User_ID_Pk}`).emit("ride_cancelled", cancelPayload);
                            }
                        }
                        // Push: customer always gets cancel notification; driver gets it when customer cancelled
                        try {
                            await notifyCustomer(ride.User_ID_Fk, 'Ride cancelled', 'Your ride was cancelled.', pushData);
                            await notifyDriver(ride.Driver_ID_Fk, 'Ride cancelled', 'The customer cancelled the ride.', pushData);
                        } catch (e) { console.warn('Push notify error:', e?.message); }
                    } else {
                        // Rider abandoned before acceptance → notify drivers in vehicle room; push to customer only
                        io.to(`vehicle:${ride.Vehicle_Type}`).emit("ride_unavailable", { ride_id });
                        try { await notifyCustomer(ride.User_ID_Fk, 'Ride cancelled', 'Your ride was cancelled.', pushData); } catch (e) { console.warn('Push notify error:', e?.message); }
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

            const [rides] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
            if (rides.length === 0) {
                return res.status(404).json({ success: false, message: "Ride not found" });
            }

            if (rides[0].Ride_Status !== 'Started') {
                return res.status(400).json({ success: false, message: "Only started rides can be completed" });
            }

            await conn.query(
                "UPDATE ride_history SET Ride_Status = 'Completed', End_Time = NOW() WHERE Ride_ID_Pk = ?",
                [ride_id]
            );

            // Insert driver earning (one row per completed ride)
            try {
                const ride = rides[0];
                const totalFare = parseFloat(ride.Fare || 0);
                const orgFee = parseFloat(ride.Organization_Fee || 0);
                const driverEarning = Math.max(0, totalFare - orgFee);
                await conn.query(
                    `INSERT INTO driver_earnings (Ride_ID_Fk, Driver_ID_Fk, Total_Fare, Organization_Fee, Driver_Earning, Payment_Method, Vehicle_Type, Earned_At)
                     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [ride_id, ride.Driver_ID_Fk, totalFare, orgFee, driverEarning, ride.Payment_Method || 'Cash', ride.Vehicle_Type || null]
                );
            } catch (earnErr) {
                console.error("Driver earning insert (non-blocking):", earnErr.message);
            }

            // Update driver period totals (incremental). Limits from vehicle_fare_rate via JOIN when needed.
            try {
                const ride = rides[0];
                const driverId = ride.Driver_ID_Fk;
                const vehicleType = ride.Vehicle_Type || null;

                // Increment the \"unpaid\" counters on drivers.
                // These represent rides/earnings since last dues clear, NOT all-time totals.
                const totalFare = parseFloat(ride.Fare || 0);
                const orgFee = parseFloat(ride.Organization_Fee || 0);
                const driverEarning = Math.max(0, totalFare - orgFee);

                await conn.query(
                    "UPDATE drivers SET completed_rides_count = completed_rides_count + 1, driver_earnings_sum = driver_earnings_sum + ? WHERE id = ?",
                    [driverEarning, driverId]
                );

                // Read back current period totals to compare against limits
                const [driverTotals] = await conn.query(
                    "SELECT completed_rides_count FROM drivers WHERE id = ?",
                    [driverId]
                );
                const totalRides = parseInt(driverTotals[0]?.completed_rides_count || 0, 10);

                let ridesLimit = 0;
                let vehicleRidesOverLimitCount = 0;
                if (vehicleType) {
                    const [rateRows] = await conn.query(
                        "SELECT rides_limit, rides_over_limit_count FROM vehicle_fare_rate WHERE Vehicle_Type = ? AND Is_Active = 1 LIMIT 1",
                        [vehicleType]
                    );
                    ridesLimit = parseInt(rateRows[0]?.rides_limit ?? 0, 10);
                    vehicleRidesOverLimitCount = parseInt(rateRows[0]?.rides_over_limit_count ?? 0, 10);
                }
                const ridesBeyondMax = ridesLimit > 0 ? Math.max(0, totalRides - ridesLimit) : 0;
                const meetsLimit = (ridesLimit > 0 && totalRides >= ridesLimit) ||
                    (vehicleRidesOverLimitCount > 0 && ridesBeyondMax >= vehicleRidesOverLimitCount);
                if (meetsLimit) {
                    await conn.query(
                        "UPDATE drivers SET overdue_since = COALESCE(overdue_since, NOW()) WHERE id = ? AND overdue_since IS NULL",
                        [driverId]
                    );
                }
            } catch (driverUpdateErr) {
                console.error("Driver totals/limit update (non-blocking):", driverUpdateErr.message);
            }

            const [completedRide] = await conn.query(
                `SELECT r.*, d.full_name as driver_name, d.phone as driver_phone,
                d.vehicle_type as driver_vehicle_type, d.vehicle_model, d.vehicle_number,
                d.vehicle_color, d.photo_path as driver_photo, d.Rating as driver_rating,
                u.User_Name as rider_name
                FROM ride_history r
                LEFT JOIN drivers d ON r.Driver_ID_Fk = d.id
                LEFT JOIN users u ON r.User_ID_Fk = u.User_ID_Pk
                WHERE r.Ride_ID_Pk = ?`,
                [ride_id]
            );

            try {
                const io = getIO();
                io.to(`user:${completedRide[0].User_ID_Fk}`).emit("ride_completed", {
                    ride_id,
                    ride: completedRide[0]
                });
                io.to(`ride:${ride_id}`).emit("ride_completed", {
                    ride_id,
                    ride: completedRide[0]
                });
                try { await notifyCustomer(completedRide[0].User_ID_Fk, 'Ride completed', 'Thank you for riding with us.', { ride_id: String(ride_id), event: 'ride_completed' }); } catch (e) { console.warn('Push notify error:', e?.message); }
            } catch (socketErr) {
                console.error("Socket emit error (non-blocking):", socketErr.message);
            }

            res.json({ success: true, message: "Ride completed successfully", ride: completedRide[0] });
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
            if (ride.Ride_Status !== 'Arrived') {
                return res.status(400).json({ success: false, message: `Ride must be 'Arrived' to start (Current: ${ride.Ride_Status})` });
            }

            const [driverRows] = await conn.query("SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')", [user.phone]);
            if (driverRows.length === 0 || driverRows[0].id !== ride.Driver_ID_Fk) {
                return res.status(403).json({ success: false, message: "Only the assigned driver can start this ride" });
            }

            await conn.query(
                "UPDATE ride_history SET Ride_Status = 'Started', Start_Time = NOW() WHERE Ride_ID_Pk = ?",
                [ride_id]
            );

            // Notify rider that ride has started
            try {
                const io = getIO();
                io.to(`user:${ride.User_ID_Fk || ''}`).emit("ride_started", { ride_id });
                io.to(`ride:${ride_id}`).emit("ride_started", { ride_id });
                try { await notifyCustomer(ride.User_ID_Fk, 'Ride started', 'Your ride has started.', { ride_id: String(ride_id), event: 'ride_started' }); } catch (e) { console.warn('Push notify error:', e?.message); }
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

    markArrived: async (req, res) => {
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
                return res.status(400).json({ success: false, message: "Ride must be 'Accepted' to mark as arrived" });
            }

            if (ride.Driver_ID_Fk === null) {
                return res.status(403).json({ success: false, message: "No driver assigned to this ride" });
            }

            const [driverRows] = await conn.query("SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')", [user.phone]);
            if (driverRows.length === 0 || driverRows[0].id !== ride.Driver_ID_Fk) {
                return res.status(403).json({ success: false, message: "Only the assigned driver can mark arrival" });
            }

            await conn.query(
                "UPDATE ride_history SET Ride_Status = 'Arrived' WHERE Ride_ID_Pk = ?",
                [ride_id]
            );

            // Notify rider
            try {
                const io = getIO();
                io.to(`user:${ride.User_ID_Fk}`).emit("ride_arrived", { ride_id });
                io.to(`ride:${ride_id}`).emit("ride_arrived", { ride_id });
                try { await notifyCustomer(ride.User_ID_Fk, 'Driver arrived', 'Your driver has arrived at pickup.', { ride_id: String(ride_id), event: 'ride_arrived' }); } catch (e) { console.warn('Push notify error:', e?.message); }
            } catch (socketErr) {
                console.error("Socket emit error:", socketErr.message);
            }

            res.json({ success: true, message: "Marked as arrived" });
        } catch (err) {
            console.error("Mark Arrived Error:", err);
            res.status(500).json({ success: false, message: "Error marking arrival", error: err.message });
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
        const MAX_RETRIES = 2;

        if (!ride_id || fare === undefined) {
            console.log("❌ Update Fare Missing Data:", { ride_id, fare });
            return res.status(400).json({ success: false, message: "Ride ID and new fare are required" });
        }
        console.log("🚀 Update Fare Request:", { ride_id, fare, userId: user.userId });

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            let conn;
            try {
                conn = await pool.getConnection();

                const [rides] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
                if (rides.length === 0) {
                    conn.release();
                    console.log("❌ Update Fare: Ride not found ID:", ride_id);
                    return res.status(404).json({ success: false, message: "Ride not found" });
                }

                const ride = rides[0];
                if (ride.User_ID_Fk != user.userId) {
                    conn.release();
                    console.log("❌ Update Fare Forbidden:", { rideUserId: ride.User_ID_Fk, currentUserId: user.userId });
                    return res.status(403).json({ success: false, message: "You can only update fares for rides you created" });
                }

                if (ride.Ride_Status !== 'Requested') {
                    conn.release();
                    console.log("❌ Update Fare Invalid Status:", ride.Ride_Status);
                    return res.status(400).json({ success: false, message: `Fare can only be updated for 'Requested' rides. Current: ${ride.Ride_Status}` });
                }

                const payload = {
                    ride_id: Number(ride_id),
                    fare: Number(fare),
                    base_fare: Number(base_fare || ride.Base_Fare || 0),
                    per_km_rate: Number(per_km_rate || ride.Per_Km_Rate || 0),
                    night_charge: Number(night_charge || ride.Night_Charge || 0),
                    peak_hour_surcharge: Number(peak_hour_surcharge || ride.Peak_Hour_Surcharge || 0),
                    waiting_charges: Number(waiting_charges || ride.Waiting_Charges || 0),
                };
                console.log('🚀 Updating Ride Fare with Payload:', payload);

                const [updateResult] = await conn.query(
                    `UPDATE ride_history SET 
                        Fare = ?, Base_Fare = ?, Per_Km_Rate = ?, 
                        Night_Charge = ?, Peak_Hour_Surcharge = ?, 
                        Waiting_Charges = ? 
                    WHERE Ride_ID_Pk = ?`,
                    [
                        payload.fare,
                        payload.base_fare,
                        payload.per_km_rate,
                        payload.night_charge,
                        payload.peak_hour_surcharge,
                        payload.waiting_charges,
                        payload.ride_id
                    ]
                );

                if (updateResult.affectedRows === 0) {
                    conn.release();
                    console.log("⚠️ Update Fare: No rows updated (0 affectedRows) for ID:", ride_id);
                    return res.status(500).json({ success: false, message: "Failed to update fare record in database" });
                }

                console.log("✅ DB Updated successfully. rowsAffected:", updateResult.affectedRows);

                // Notify drivers about fare update
                try {
                    const io = getIO();
                    const [updatedRide] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
                    const vehicleRoom = `vehicle:${String(ride.Vehicle_Type).toLowerCase()}`;

                    console.log(`📡 Emitting fare_updated to ${vehicleRoom}`);
                    io.to(vehicleRoom).emit("fare_updated", {
                        ride_id: Number(ride_id),
                        new_fare: Number(fare),
                        ride: { ...updatedRide[0], Fare: Number(fare) }
                    });
                } catch (socketErr) {
                    console.error("Socket emit error (non-blocking):", socketErr.message);
                }

                conn.release();
                return res.json({ success: true, message: "Ride fare updated successfully" });

            } catch (err) {
                if (conn) {
                    try { conn.release(); } catch (e) { /* ignore */ }
                }

                const isConnError = err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' ||
                    err.code === 'PROTOCOL_CONNECTION_LOST' || err.message?.includes('ECONNRESET');

                if (isConnError && attempt < MAX_RETRIES) {
                    console.log(`🔄 updateFare: DB connection error, retrying (${attempt + 1}/${MAX_RETRIES})...`);
                    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                    continue;
                }

                console.error("Update Fare Error:", err);
                return res.status(500).json({ success: false, message: "Error updating fare", error: err.message });
            }
        }
    },

    getRideHistory: async (req, res) => {
        const { status, limit, offset } = req.query;
        const user = req.user;
        let conn;
        try {
            conn = await pool.getConnection();

            const isDriver = user.role && String(user.role).toLowerCase() === 'driver';
            let rides = [];

            if (isDriver) {
                const [driverRows] = await conn.query(
                    "SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                    [user.phone]
                );
                if (driverRows.length === 0) {
                    return res.status(404).json({ success: false, message: "Driver profile not found" });
                }
                const driverId = driverRows[0].id;

                let statusClause = "";
                const queryParams = [driverId];
                if (status) {
                    const statusTrimmed = String(status).trim();
                    if (statusTrimmed.includes(',')) {
                        const statusArray = statusTrimmed.split(',').map((s) => s.trim()).filter(Boolean);
                        if (statusArray.length > 0) {
                            statusClause = `AND r.Ride_Status IN (${statusArray.map(() => '?').join(',')}) `;
                            queryParams.push(...statusArray);
                        }
                    } else {
                        statusClause = "AND r.Ride_Status = ? ";
                        queryParams.push(statusTrimmed);
                    }
                }

                const limitVal = Math.min(parseInt(limit, 10) || 50, 100);
                const offsetVal = Math.max(0, parseInt(offset, 10) || 0);

                const [ridesRows] = await conn.query(
                    `SELECT r.*, u.User_Name as rider_name, u.Mobile as rider_phone
                     FROM ride_history r
                     LEFT JOIN users u ON r.User_ID_Fk = u.User_ID_Pk
                     WHERE r.Driver_ID_Fk = ? ${statusClause}
                     ORDER BY r.CreatedAt DESC
                     LIMIT ? OFFSET ?`,
                    [...queryParams, limitVal, offsetVal]
                );
                rides = ridesRows;
            } else {
                let query = "SELECT * FROM ride_history WHERE User_ID_Fk = ? ";
                const queryParams = [user.userId];

                if (status) {
                    const statusTrimmed = String(status).trim();
                    if (statusTrimmed.includes(',')) {
                        const statusArray = statusTrimmed.split(',').map((s) => s.trim()).filter(Boolean);
                        if (statusArray.length > 0) {
                            query += `AND Ride_Status IN (${statusArray.map(() => '?').join(',')}) `;
                            queryParams.push(...statusArray);
                        }
                    } else {
                        query += "AND Ride_Status = ? ";
                        queryParams.push(statusTrimmed);
                    }
                }

                query += "ORDER BY CreatedAt DESC";
                const limitVal = Math.min(parseInt(limit, 10) || 50, 100);
                const offsetVal = Math.max(0, parseInt(offset, 10) || 0);
                query += " LIMIT ? OFFSET ?";
                queryParams.push(limitVal, offsetVal);

                const [ridesRows] = await conn.query(query, queryParams);
                rides = ridesRows;
            }

            res.json({ success: true, count: rides.length, data: rides });
        } catch (err) {
            console.error("Get Ride History Error:", err);
            res.status(500).json({ success: false, message: "Error fetching ride history", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    submitReview: async (req, res) => {
        const { ride_id, rating, feedback_tags, comment } = req.body;
        const user = req.user;

        if (!ride_id || !rating) {
            return res.status(400).json({ success: false, message: "Ride ID and rating are required" });
        }

        if (rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const [rides] = await conn.query("SELECT * FROM ride_history WHERE Ride_ID_Pk = ?", [ride_id]);
            if (rides.length === 0) {
                return res.status(404).json({ success: false, message: "Ride not found" });
            }

            const ride = rides[0];
            if (ride.Ride_Status !== 'Completed') {
                return res.status(400).json({ success: false, message: "Can only review completed rides" });
            }

            // Create ride_reviews table if not exists
            await conn.query(`
                CREATE TABLE IF NOT EXISTS ride_reviews (
                    Review_ID_Pk INT AUTO_INCREMENT PRIMARY KEY,
                    Ride_ID_Fk INT NOT NULL,
                    Reviewer_ID_Fk INT NOT NULL,
                    Reviewee_ID_Fk INT DEFAULT NULL,
                    Reviewer_Role ENUM('User','Driver') NOT NULL,
                    Rating TINYINT NOT NULL,
                    Feedback_Tags TEXT DEFAULT NULL,
                    Comment TEXT DEFAULT NULL,
                    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_review (Ride_ID_Fk, Reviewer_ID_Fk)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            const reviewerRole = user.role === 'driver' ? 'Driver' : 'User';
            const revieweeId = reviewerRole === 'User' ? ride.Driver_ID_Fk : ride.User_ID_Fk;
            const tagsStr = Array.isArray(feedback_tags) ? feedback_tags.join(',') : (feedback_tags || null);

            await conn.query(
                `INSERT INTO ride_reviews (Ride_ID_Fk, Reviewer_ID_Fk, Reviewee_ID_Fk, Reviewer_Role, Rating, Feedback_Tags, Comment)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE Rating = ?, Feedback_Tags = ?, Comment = ?`,
                [ride_id, user.userId, revieweeId, reviewerRole, rating, tagsStr, comment || null,
                    rating, tagsStr, comment || null]
            );

            // Update driver's average rating if reviewed by a user
            if (reviewerRole === 'User' && ride.Driver_ID_Fk) {
                const [avgResult] = await conn.query(
                    `SELECT AVG(Rating) as avg_rating FROM ride_reviews 
                     WHERE Reviewee_ID_Fk = ? AND Reviewer_Role = 'User'`,
                    [ride.Driver_ID_Fk]
                );
                if (avgResult[0]?.avg_rating) {
                    await conn.query("UPDATE drivers SET Rating = ? WHERE id = ?",
                        [Math.round(avgResult[0].avg_rating), ride.Driver_ID_Fk]);
                }
            }

            res.json({ success: true, message: "Review submitted successfully" });
        } catch (err) {
            console.error("Submit Review Error:", err);
            res.status(500).json({ success: false, message: "Error submitting review", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getDriverProfile: async (req, res) => {
        const user = req.user;

        let conn;
        try {
            conn = await pool.getConnection();

            const [driverRows] = await conn.query(
                "SELECT * FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                [user.phone]
            );

            if (driverRows.length === 0) {
                return res.status(404).json({ success: false, message: "Driver profile not found" });
            }

            const driver = driverRows[0];

            // Ensure ride_reviews table exists before querying
            await conn.query(`
                CREATE TABLE IF NOT EXISTS ride_reviews (
                    Review_ID_Pk INT AUTO_INCREMENT PRIMARY KEY,
                    Ride_ID_Fk INT NOT NULL,
                    Reviewer_ID_Fk INT NOT NULL,
                    Reviewee_ID_Fk INT DEFAULT NULL,
                    Reviewer_Role ENUM('User','Driver') NOT NULL,
                    Rating TINYINT NOT NULL,
                    Feedback_Tags TEXT DEFAULT NULL,
                    Comment TEXT DEFAULT NULL,
                    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_review (Ride_ID_Fk, Reviewer_ID_Fk)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            const [reviewStats] = await conn.query(
                `SELECT COUNT(*) as total_reviews, AVG(Rating) as avg_rating 
                 FROM ride_reviews WHERE Reviewee_ID_Fk = ? AND Reviewer_Role = 'User'`,
                [driver.id]
            );

            const [rideStats] = await conn.query(
                `SELECT COUNT(*) as total_rides, 
                 SUM(CASE WHEN Ride_Status = 'Completed' THEN 1 ELSE 0 END) as completed_rides
                 FROM ride_history WHERE Driver_ID_Fk = ?`,
                [driver.id]
            );

            // Overdue: get limits from vehicle_fare_rate (JOIN by vehicle_type), compute meetsLimit
            let overdue_info = null;
            const totalRides = parseInt(driver.completed_rides_count || 0, 10);
            let vehicleRidesLimit = 0;
            let vehicleRidesOverLimitCount = 0;
            if (driver.vehicle_type) {
                const [rateRows] = await conn.query(
                    "SELECT rides_limit, rides_over_limit_count FROM vehicle_fare_rate WHERE Vehicle_Type = ? AND Is_Active = 1 LIMIT 1",
                    [driver.vehicle_type]
                );
                vehicleRidesLimit = parseInt(rateRows[0]?.rides_limit ?? 0, 10);
                vehicleRidesOverLimitCount = parseInt(rateRows[0]?.rides_over_limit_count ?? 0, 10);
            }
            const ridesBeyondMax = vehicleRidesLimit > 0 ? Math.max(0, totalRides - vehicleRidesLimit) : 0;
            const meetsLimit = (vehicleRidesLimit > 0 && totalRides >= vehicleRidesLimit) ||
                (vehicleRidesOverLimitCount > 0 && ridesBeyondMax >= vehicleRidesOverLimitCount);

            if (meetsLimit) {
                if (!driver.overdue_since) {
                    await conn.query("UPDATE drivers SET overdue_since = NOW() WHERE id = ? AND overdue_since IS NULL", [driver.id]);
                    driver.overdue_since = new Date().toISOString().slice(0, 19).replace('T', ' ');
                }
                const [overdueRows] = await conn.query(
                    "SELECT TIMESTAMPDIFF(HOUR, overdue_since, NOW()) as hours_overdue, overdue_since FROM drivers WHERE id = ?",
                    [driver.id]
                );
                const hoursOverdue = parseInt(overdueRows[0]?.hours_overdue ?? 0, 10);
                const hoursRemaining = Math.max(0, 8 - hoursOverdue);
                overdue_info = {
                    overdue_since: overdueRows[0]?.overdue_since || driver.overdue_since,
                    hours_overdue: hoursOverdue,
                    hours_remaining: hoursRemaining,
                    is_blocked: hoursOverdue >= 8,
                    amount_due: parseFloat(driver.driver_earnings_sum || 0),
                    rides_count: totalRides,
                };
            }

            res.json({
                success: true,
                driver: {
                    ...driver,
                    total_reviews: reviewStats[0]?.total_reviews || 0,
                    avg_rating: reviewStats[0]?.avg_rating ? parseFloat(reviewStats[0].avg_rating).toFixed(1) : '0.0',
                    total_rides: rideStats[0]?.total_rides || 0,
                    completed_rides: rideStats[0]?.completed_rides || 0,
                    overdue_info,
                }
            });
        } catch (err) {
            console.error("Get Driver Profile Error:", err);
            res.status(500).json({ success: false, message: "Error fetching driver profile", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    clearOverdue: async (req, res) => {
        const user = req.user;
        const isDriver = user.role && String(user.role).toLowerCase() === 'driver';
        if (!isDriver) {
            return res.status(403).json({ success: false, message: "Only drivers can clear overdue" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const [driverRows] = await conn.query(
                "SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                [user.phone]
            );
            if (driverRows.length === 0) {
                return res.status(404).json({ success: false, message: "Driver profile not found" });
            }
            const driverId = driverRows[0].id;

            await conn.query(
                "UPDATE drivers SET overdue_since = NULL, driver_earnings_sum = 0, completed_rides_count = 0 WHERE id = ?",
                [driverId]
            );

            res.json({ success: true, message: "Overdue cleared. You can now find rides." });
        } catch (err) {
            console.error("Clear Overdue Error:", err);
            res.status(500).json({ success: false, message: "Error clearing overdue", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getDriverEarnings: async (req, res) => {
        const user = req.user;
        const isDriver = user.role && String(user.role).toLowerCase() === 'driver';
        if (!isDriver) {
            return res.status(403).json({ success: false, message: "Only drivers can view earnings" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const [driverRows] = await conn.query(
                "SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                [user.phone]
            );
            if (driverRows.length === 0) {
                return res.status(404).json({ success: false, message: "Driver profile not found" });
            }
            const driverId = driverRows[0].id;

            const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
            const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

            const [rows] = await conn.query(
                `SELECT e.Earning_ID_Pk, e.Ride_ID_Fk, e.Total_Fare, e.Organization_Fee, e.Driver_Earning, e.Payment_Method, e.Vehicle_Type, e.Earned_At, e.CreatedAt,
                 r.Pickup_Location, r.Drop_Location, r.Ride_Date
                 FROM driver_earnings e
                 LEFT JOIN ride_history r ON r.Ride_ID_Pk = e.Ride_ID_Fk
                 WHERE e.Driver_ID_Fk = ?
                 ORDER BY e.Earned_At DESC
                 LIMIT ? OFFSET ?`,
                [driverId, limit, offset]
            );

            const [summaryRows] = await conn.query(
                `SELECT COUNT(*) as total_rides, COALESCE(SUM(Driver_Earning), 0) as total_earning
                 FROM driver_earnings WHERE Driver_ID_Fk = ?`,
                [driverId]
            );

            const [driverInfo] = await conn.query(
                "SELECT vehicle_type, overdue_since, driver_earnings_sum, completed_rides_count FROM drivers WHERE id = ?",
                [driverId]
            );
            const d = driverInfo[0];
            let overdue_info = null;
            const totalRides = parseInt(d?.completed_rides_count || 0, 10);
            let vehicleRidesLimit = 0;
            let vehicleRidesOverLimitCount = 0;
            if (d?.vehicle_type) {
                const [rateRows] = await conn.query(
                    "SELECT rides_limit, rides_over_limit_count FROM vehicle_fare_rate WHERE Vehicle_Type = ? AND Is_Active = 1 LIMIT 1",
                    [d.vehicle_type]
                );
                vehicleRidesLimit = parseInt(rateRows[0]?.rides_limit ?? 0, 10);
                vehicleRidesOverLimitCount = parseInt(rateRows[0]?.rides_over_limit_count ?? 0, 10);
            }
            const ridesBeyondMax = vehicleRidesLimit > 0 ? Math.max(0, totalRides - vehicleRidesLimit) : 0;
            const meetsLimit = (vehicleRidesLimit > 0 && totalRides >= vehicleRidesLimit) ||
                (vehicleRidesOverLimitCount > 0 && ridesBeyondMax >= vehicleRidesOverLimitCount);

            if (meetsLimit) {
                if (!d?.overdue_since) {
                    await conn.query("UPDATE drivers SET overdue_since = NOW() WHERE id = ? AND overdue_since IS NULL", [driverId]);
                }
                const [overdueRows] = await conn.query(
                    "SELECT TIMESTAMPDIFF(HOUR, overdue_since, NOW()) as hours_overdue, overdue_since FROM drivers WHERE id = ?",
                    [driverId]
                );
                const hoursOverdue = parseInt(overdueRows[0]?.hours_overdue ?? 0, 10);
                overdue_info = {
                    overdue_since: overdueRows[0]?.overdue_since || d?.overdue_since,
                    hours_overdue: hoursOverdue,
                    hours_remaining: Math.max(0, 8 - hoursOverdue),
                    is_blocked: hoursOverdue >= 8,
                    amount_due: parseFloat(d?.driver_earnings_sum || 0),
                    rides_count: totalRides,
                };
            }

            const summary = {
                total_rides: summaryRows[0]?.total_rides || 0,
                total_earning: parseFloat(summaryRows[0]?.total_earning || 0),
            };

            res.json({ success: true, data: rows, summary, overdue_info });
        } catch (err) {
            console.error("Get Driver Earnings Error:", err);
            res.status(500).json({ success: false, message: "Error fetching earnings", error: err.message });
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
    },

    getActiveRide: async (req, res) => {
        const user = req.user;
        const MAX_RETRIES = 2;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            let conn;
            try {
                conn = await pool.getConnection();

                const isDriver = user.role && String(user.role).toLowerCase() === 'driver';

                let ride = null;

                if (isDriver) {
                    // Find the driver's id from phone
                    const [driverRows] = await conn.query(
                        "SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                        [user.phone]
                    );
                    if (driverRows.length === 0) {
                        conn.release();
                        return res.json({ success: true, hasActiveRide: false, ride: null });
                    }
                    const driverId = driverRows[0].id;

                    const [rides] = await conn.query(
                        `SELECT r.*, u.User_Name as rider_name, u.Mobile as rider_phone
                         FROM ride_history r
                         LEFT JOIN users u ON r.User_ID_Fk = u.User_ID_Pk
                         WHERE r.Driver_ID_Fk = ? AND r.Ride_Status IN ('Accepted', 'Arrived', 'Started')
                         ORDER BY r.CreatedAt DESC LIMIT 1`,
                        [driverId]
                    );
                    if (rides.length > 0) ride = rides[0];
                } else {
                    // Rider: check for any active ride OR recently completed ride (so feedback screen shows)
                    const [rides] = await conn.query(
                        `SELECT r.*, d.full_name as driver_name, d.phone as driver_phone,
                         d.vehicle_type as driver_vehicle_type, d.vehicle_model, d.vehicle_number,
                         d.vehicle_color, d.photo_path as driver_photo, d.Rating as driver_rating
                         FROM ride_history r
                         LEFT JOIN drivers d ON r.Driver_ID_Fk = d.id
                         WHERE r.User_ID_Fk = ? AND (
                             r.Ride_Status IN ('Requested', 'Accepted', 'Arrived', 'Started')
                             OR (r.Ride_Status = 'Completed' AND r.End_Time >= NOW() - INTERVAL 5 MINUTE)
                             OR (r.Ride_Status = 'Cancelled' AND r.CreatedAt >= NOW() - INTERVAL 2 MINUTE)
                         )
                         ORDER BY FIELD(r.Ride_Status, 'Started', 'Arrived', 'Accepted', 'Requested', 'Completed', 'Cancelled'), r.CreatedAt DESC LIMIT 1`,
                        [user.userId]
                    );
                    if (rides.length > 0) ride = rides[0];
                }

                conn.release();

                if (ride) {
                    return res.json({ success: true, hasActiveRide: true, ride });
                }
                return res.json({ success: true, hasActiveRide: false, ride: null });

            } catch (err) {
                if (conn) {
                    try { conn.release(); } catch (e) { /* ignore */ }
                }

                // Retry on connection reset errors
                const isConnError = err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' ||
                    err.code === 'PROTOCOL_CONNECTION_LOST' || err.message?.includes('ECONNRESET');

                if (isConnError && attempt < MAX_RETRIES) {
                    console.log(`🔄 getActiveRide: DB connection error, retrying (${attempt + 1}/${MAX_RETRIES})...`);
                    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                    continue;
                }

                console.error("Get Active Ride Error:", err);
                return res.status(500).json({ success: false, message: "Error checking active ride", error: err.message });
            }
        }
    },

    /**
     * POST /ride/share-link
     * Generates (or returns existing) share_token for a ride owned by the caller.
     * Body: { ride_id }
     * Returns: { success, token }
     */
    generateShareLink: async (req, res) => {
        let conn;
        try {
            const { ride_id } = req.body;
            const userId = req.user.userId;
            if (!ride_id) return res.status(400).json({ success: false, message: 'ride_id is required' });

            conn = await pool.getConnection();

            const [rows] = await conn.query(
                "SELECT Ride_ID_Pk, User_ID_Fk, share_token FROM ride_history WHERE Ride_ID_Pk = ?",
                [ride_id]
            );
            if (rows.length === 0) {
                conn.release();
                return res.status(404).json({ success: false, message: 'Ride not found' });
            }
            const ride = rows[0];

            if (ride.User_ID_Fk !== userId) {
                conn.release();
                return res.status(403).json({ success: false, message: 'You can only share your own ride' });
            }

            let token = ride.share_token;
            if (!token) {
                token = crypto.randomBytes(32).toString('hex');
                await conn.query("UPDATE ride_history SET share_token = ? WHERE Ride_ID_Pk = ?", [token, ride_id]);
            }

            conn.release();
            return res.json({ success: true, token });
        } catch (err) {
            if (conn) conn.release();
            console.error("Generate Share Link Error:", err);
            return res.status(500).json({ success: false, message: 'Error generating share link', error: err.message });
        }
    },

    /**
     * GET /ride/track/:token
     * Serves an HTML redirect page — tries to open the GoRide app,
     * otherwise shows ride info in the browser. This URL is WhatsApp-friendly.
     */
    trackRedirectPage: async (req, res) => {
        let conn;
        try {
            const { token } = req.params;
            if (!token || token.length < 16) {
                return res.status(400).send('Invalid tracking link.');
            }

            conn = await pool.getConnection();
            const [rides] = await conn.query(
                `SELECT r.Ride_ID_Pk, r.Ride_Status, r.Pickup_Location, r.Drop_Location,
                        d.full_name AS driver_name, d.vehicle_model, d.vehicle_number,
                        d.vehicle_color, d.Rating AS driver_rating
                 FROM ride_history r
                 LEFT JOIN drivers d ON r.Driver_ID_Fk = d.id
                 WHERE r.share_token = ?
                 LIMIT 1`,
                [token]
            );
            conn.release();

            if (rides.length === 0) {
                return res.status(404).send('Ride not found or link has expired.');
            }

            const ride = rides[0];
            const deepLink = `goride://track?token=${token}`;
            const statusMap = {
                Accepted: 'Driver is on the way',
                Arrived: 'Driver has arrived',
                Started: 'Ride in progress',
                Completed: 'Ride completed',
                Cancelled: 'Ride was cancelled',
            };
            const statusLabel = statusMap[ride.Ride_Status] || ride.Ride_Status;

            const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Track Ride - GoRide</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0D0D0D;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.card{background:#1A1A1A;border-radius:20px;padding:28px;max-width:380px;width:100%;text-align:center}
.logo{font-size:28px;font-weight:800;color:#22E843;margin-bottom:6px}
.subtitle{color:#888;font-size:13px;margin-bottom:24px}
.status{display:inline-block;background:rgba(34,232,67,0.12);color:#22E843;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;margin-bottom:20px}
.driver{display:flex;align-items:center;gap:12px;text-align:left;margin-bottom:16px;padding:12px;background:#252525;border-radius:12px}
.avatar{width:44px;height:44px;border-radius:22px;background:#333;display:flex;align-items:center;justify-content:center;font-size:20px}
.dname{font-weight:600;font-size:15px}
.dmeta{color:#888;font-size:12px;margin-top:2px}
.loc{text-align:left;padding:10px 12px;background:#252525;border-radius:12px;margin-bottom:8px}
.loc .label{color:#888;font-size:11px;margin-bottom:3px}
.loc .addr{font-size:13px;line-height:1.4}
.btn{display:block;width:100%;padding:14px;border:none;border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;margin-top:18px;text-decoration:none;color:#0D0D0D;background:linear-gradient(135deg,#22E843,#1BCC3A)}
.note{color:#666;font-size:11px;margin-top:14px;line-height:1.4}
</style>
</head>
<body>
<div class="card">
 <div class="logo">GoRide</div>
 <div class="subtitle">Live Ride Tracking</div>
 <div class="status">${statusLabel}</div>
 ${ride.driver_name ? `
 <div class="driver">
  <div class="avatar">🚗</div>
  <div>
   <div class="dname">${ride.driver_name}</div>
   <div class="dmeta">${[ride.vehicle_model, ride.vehicle_color, ride.vehicle_number].filter(Boolean).join(' • ')}${ride.driver_rating ? ' ★ ' + Number(ride.driver_rating).toFixed(1) : ''}</div>
  </div>
 </div>` : ''}
 <div class="loc"><div class="label">Pickup</div><div class="addr">${ride.Pickup_Location || '-'}</div></div>
 <div class="loc"><div class="label">Destination</div><div class="addr">${ride.Drop_Location || '-'}</div></div>
 <a href="${deepLink}" class="btn" id="openApp">Open in GoRide App</a>
 <p class="note">If the app doesn't open automatically, make sure GoRide is installed on your device.</p>
</div>
<script>
setTimeout(function(){ window.location.href = "${deepLink}"; }, 600);
</script>
</body>
</html>`;

            res.setHeader('Content-Type', 'text/html');
            return res.send(html);
        } catch (err) {
            if (conn) conn.release();
            console.error("Track Redirect Page Error:", err);
            return res.status(500).send('Something went wrong.');
        }
    },

    /**
     * GET /ride/public/:token
     * Public (no auth required) — returns ride + driver details for tracking.
     */
    getPublicRideTracking: async (req, res) => {
        let conn;
        try {
            const { token } = req.params;
            if (!token || token.length < 16) {
                return res.status(400).json({ success: false, message: 'Invalid tracking token' });
            }

            conn = await pool.getConnection();

            const [rides] = await conn.query(
                `SELECT r.Ride_ID_Pk, r.Ride_Status, r.Pickup_Location, r.Drop_Location,
                        r.Pickup_Lat, r.Pickup_Lng, r.Drop_Lat, r.Drop_Lng,
                        r.Vehicle_Type, r.Fare, r.Distance, r.Duration,
                        d.full_name AS driver_name, d.phone AS driver_phone,
                        d.vehicle_type AS driver_vehicle_type, d.vehicle_model,
                        d.vehicle_number, d.vehicle_color, d.Rating AS driver_rating,
                        d.photo_path AS driver_photo
                 FROM ride_history r
                 LEFT JOIN drivers d ON r.Driver_ID_Fk = d.id
                 WHERE r.share_token = ?
                 LIMIT 1`,
                [token]
            );

            conn.release();

            if (rides.length === 0) {
                return res.status(404).json({ success: false, message: 'Ride not found or link expired' });
            }

            const ride = rides[0];
            return res.json({ success: true, ride });
        } catch (err) {
            if (conn) conn.release();
            console.error("Public Ride Tracking Error:", err);
            return res.status(500).json({ success: false, message: 'Error fetching ride tracking', error: err.message });
        }
    }
};

module.exports = rideController;

