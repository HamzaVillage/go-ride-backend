const pool = require('../db/Connect_Db');
const { getIO } = require('../socket/socketManager');

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
                "SELECT id, vehicle_type FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                [user.phone]
            );
            const driverVehicleType = vehicle_type || (driverRows.length > 0 ? driverRows[0].vehicle_type : 'Mini');

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
                io.to(`user:${updatedRide[0].User_ID_Fk}`).emit("ride_accepted", {
                    ride_id,
                    driver_id,
                    ride: updatedRide[0]
                });
                io.to(`vehicle:${updatedRide[0].Vehicle_Type}`).emit("ride_unavailable", {
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

            // Emit cancellation notification
            try {
                const io = getIO();
                const cancelPayload = { ride_id, cancelled_by, reason, ride };
                if (cancelled_by === 'Driver' && ride.User_ID_Fk) {
                    // Driver cancelled → notify rider
                    io.to(`user:${ride.User_ID_Fk}`).emit("ride_cancelled", cancelPayload);
                    io.to(`ride:${ride_id}`).emit("ride_cancelled", cancelPayload);
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
                    io.to(`vehicle:${ride.Vehicle_Type.toLowerCase()}`).emit("fare_updated", {
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
        const { status } = req.query;
        const user = req.user;
        console.log(status, user);
        let conn;
        try {
            conn = await pool.getConnection();

            let query = "SELECT * FROM ride_history WHERE ";
            let queryParams = [];

            const isDriver = user.role && String(user.role).toLowerCase() === 'driver';

            if (isDriver) {
                const [driverRows] = await conn.query(
                    "SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                    [user.phone]
                );
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

            const [rides] = await conn.query(query, queryParams);

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

            res.json({
                success: true,
                driver: {
                    ...driver,
                    total_reviews: reviewStats[0]?.total_reviews || 0,
                    avg_rating: reviewStats[0]?.avg_rating ? parseFloat(reviewStats[0].avg_rating).toFixed(1) : '0.0',
                    total_rides: rideStats[0]?.total_rides || 0,
                    completed_rides: rideStats[0]?.completed_rides || 0,
                }
            });
        } catch (err) {
            console.error("Get Driver Profile Error:", err);
            res.status(500).json({ success: false, message: "Error fetching driver profile", error: err.message });
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
                    // Rider: check for any active ride
                    const [rides] = await conn.query(
                        `SELECT r.*, d.full_name as driver_name, d.phone as driver_phone,
                         d.vehicle_type as driver_vehicle_type, d.vehicle_model, d.vehicle_number,
                         d.vehicle_color, d.photo_path as driver_photo, d.Rating as driver_rating
                         FROM ride_history r
                         LEFT JOIN drivers d ON r.Driver_ID_Fk = d.id
                         WHERE r.User_ID_Fk = ? AND r.Ride_Status IN ('Requested', 'Accepted', 'Arrived', 'Started')
                         ORDER BY r.CreatedAt DESC LIMIT 1`,
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
    }
};

module.exports = rideController;

