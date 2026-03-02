const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const pool = require("../db/Connect_Db");

let io;

/**
 * Initialize Socket.IO on the HTTP server
 */
function initSocket(server) {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        pingInterval: 25000,
        pingTimeout: 20000,
        connectTimeout: 45000,
    });

    // ── JWT Authentication Middleware ──
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            return next(new Error("Authentication error: No token provided"));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_fallback_secret');
            socket.user = decoded; // { userId, role, phone }
            next();
        } catch (err) {
            return next(new Error("Authentication error: Invalid token"));
        }
    });

    // ── Connection Handler ──
    io.on("connection", async (socket) => {
        const { userId, role, phone } = socket.user;
        console.log(`🔌 Socket connected: ${role} (userId: ${userId}, socketId: ${socket.id})`);

        // Every user joins their personal room for targeted notifications
        socket.join(`user:${userId}`);
        console.log(`👤 User joined room: user:${userId}`);

        // ── Auto-rejoin active ride room on reconnect ──
        try {
            const conn = await pool.getConnection();
            try {
                const isDriver = role && String(role).toLowerCase() === 'driver';
                let activeRideId = null;

                if (isDriver) {
                    const [driverRows] = await conn.query(
                        "SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                        [phone]
                    );
                    if (driverRows.length > 0) {
                        const [rides] = await conn.query(
                            "SELECT Ride_ID_Pk FROM ride_history WHERE Driver_ID_Fk = ? AND Ride_Status IN ('Accepted', 'Arrived', 'Started') LIMIT 1",
                            [driverRows[0].id]
                        );
                        if (rides.length > 0) activeRideId = rides[0].Ride_ID_Pk;
                    }
                } else {
                    const [rides] = await conn.query(
                        "SELECT Ride_ID_Pk FROM ride_history WHERE User_ID_Fk = ? AND Ride_Status IN ('Requested', 'Accepted', 'Arrived', 'Started') LIMIT 1",
                        [userId]
                    );
                    if (rides.length > 0) activeRideId = rides[0].Ride_ID_Pk;
                }

                if (activeRideId) {
                    socket.join(`ride:${activeRideId}`);
                    socket.activeRideId = activeRideId;
                    console.log(`🔄 Auto-rejoined ride:${activeRideId} for ${role} userId:${userId}`);
                }
            } finally {
                conn.release();
            }
        } catch (err) {
            console.error("Auto-rejoin ride room error:", err.message);
        }

        // ── Driver goes online ──
        socket.on("driver:online", async (data) => {
            try {
                const { lat, lng, vehicle_type } = data || {};
                const conn = await pool.getConnection();
                try {
                    const [rows] = await conn.query(
                        "SELECT id, vehicle_type, overdue_since, rides_count_overdue_limit, rides_over_limit_count FROM drivers WHERE REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                        [phone]
                    );
                    if (rows.length === 0) {
                        socket.emit("driver:online:ack", { success: false, message: "Driver profile not found" });
                        return;
                    }
                    const driver = rows[0];
                    const dbVehicleType = (vehicle_type || driver.vehicle_type || 'mini').toLowerCase();

                    // Check if driver meets limit (from vehicle_fare_rate); backfill overdue_since if needed
                    const totalRides = parseInt(driver.rides_count_overdue_limit || 0, 10);
                    const ridesOverLimit = parseInt(driver.rides_over_limit_count || 0, 10);
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
                    const meetsLimit = (vehicleRidesLimit > 0 && totalRides >= vehicleRidesLimit) ||
                        (vehicleRidesOverLimitCount > 0 && ridesOverLimit >= vehicleRidesOverLimitCount);

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
                            socket.emit("driver:online:ack", {
                                success: false,
                                message: "Your account is blocked. Please clear your dues to continue finding rides.",
                                blocked: true
                            });
                            return;
                        }
                    }

                    socket.join(`vehicle:${dbVehicleType}`);
                    socket.driverInfo = { lat, lng, vehicle_type: dbVehicleType };
                    console.log(`🚗 Driver ${userId} joined room vehicle:${dbVehicleType}`);
                    socket.emit("driver:online:ack", { success: true, message: "You are now online" });
                } finally {
                    conn.release();
                }
            } catch (err) {
                console.error("driver:online error:", err.message);
                socket.emit("driver:online:ack", { success: false, message: err.message });
            }
        });

        // ── Driver goes offline ──
        socket.on("driver:offline", () => {
            if (socket.driverInfo?.vehicle_type) {
                socket.leave(`vehicle:${socket.driverInfo.vehicle_type.toLowerCase()}`);
                console.log(`🛑 Driver ${userId} left room vehicle:${socket.driverInfo.vehicle_type}`);
            }
            socket.driverInfo = null;
        });

        // ── Driver updates location (with heading for smooth car rotation) ──
        socket.on("driver:location_update", (data) => {
            const { lat, lng, heading, rideId } = data || {};
            if (socket.driverInfo) {
                socket.driverInfo.lat = lat;
                socket.driverInfo.lng = lng;
                socket.driverInfo.heading = heading || 0;
            }

            // If the driver is on an active ride, broadcast to the ride room
            const targetRideId = rideId || socket.activeRideId;
            if (targetRideId) {
                socket.to(`ride:${targetRideId}`).emit("driver:location_changed", {
                    rideId: targetRideId,
                    lat,
                    lng,
                    heading: heading || 0,
                    timestamp: new Date()
                });
            }
        });

        // ── Join a specific ride room (For both Driver & Rider) ──
        socket.on("ride:join", (data) => {
            const { rideId } = data || {};
            if (rideId) {
                socket.join(`ride:${rideId}`);
                socket.activeRideId = rideId;
                console.log(`📍 User ${userId} joined room ride:${rideId}`);
            }
        });

        // ── Leave a specific ride room ──
        socket.on("ride:leave", (data) => {
            const { rideId } = data || {};
            if (rideId) {
                socket.leave(`ride:${rideId}`);
                socket.activeRideId = null;
                console.log(`📍 User ${userId} left room ride:${rideId}`);
            }
        });

        // ── Disconnect ──
        socket.on("disconnect", (reason) => {
            console.log(`❌ Socket disconnected: ${role} (userId: ${userId}, reason: ${reason})`);
        });
    });

    console.log("🔌 Socket.IO initialized");
    return io;
}

/**
 * Get the Socket.IO instance (used by controllers)
 */
function getIO() {
    if (!io) {
        throw new Error("Socket.IO not initialized. Call initSocket(server) first.");
    }
    return io;
}

module.exports = { initSocket, getIO };
