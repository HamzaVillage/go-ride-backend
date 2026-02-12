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
        }
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
    io.on("connection", (socket) => {
        const { userId, role, phone } = socket.user;
        console.log(`🔌 Socket connected: ${role} (userId: ${userId}, socketId: ${socket.id})`);

        // Every user joins their personal room for targeted notifications
        socket.join(`user:${userId}`);

        // ── Driver goes online ──
        socket.on("driver:online", async (data) => {
            try {
                const { lat, lng, vehicle_type } = data || {};

                if (!vehicle_type) {
                    // Try to fetch from DB if not provided
                    const conn = await pool.getConnection();
                    try {
                        const [rows] = await conn.query("SELECT vehicle_type FROM drivers WHERE phone = ?", [phone]);
                        if (rows.length > 0) {
                            const dbVehicleType = rows[0].vehicle_type;
                            socket.join(`vehicle:${dbVehicleType}`);
                            socket.driverInfo = { lat, lng, vehicle_type: dbVehicleType };
                            console.log(`🚗 Driver ${userId} joined room vehicle:${dbVehicleType}`);
                        }
                    } finally {
                        conn.release();
                    }
                } else {
                    socket.join(`vehicle:${vehicle_type}`);
                    socket.driverInfo = { lat, lng, vehicle_type };
                    console.log(`🚗 Driver ${userId} joined room vehicle:${vehicle_type}`);
                }

                socket.emit("driver:online:ack", { success: true, message: "You are now online" });
            } catch (err) {
                console.error("driver:online error:", err.message);
                socket.emit("driver:online:ack", { success: false, message: err.message });
            }
        });

        // ── Driver goes offline ──
        socket.on("driver:offline", () => {
            if (socket.driverInfo?.vehicle_type) {
                socket.leave(`vehicle:${socket.driverInfo.vehicle_type}`);
                console.log(`🛑 Driver ${userId} left room vehicle:${socket.driverInfo.vehicle_type}`);
            }
            socket.driverInfo = null;
        });

        // ── Driver updates location ──
        socket.on("driver:location_update", (data) => {
            if (socket.driverInfo) {
                socket.driverInfo.lat = data.lat;
                socket.driverInfo.lng = data.lng;
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
