const pool = require('../db/Connect_Db');
const pushNotificationService = require('../services/pushNotificationService');

const notificationController = {
    /**
     * Send notification to specific target
     * req.body: { target: 'all'|'role'|'specific', role: 'rider'|'driver', userId, isDriver, title, body, data }
     */
    sendNotification: async (req, res) => {
        const { target, role, userId, isDriver, title, body, data = {} } = req.body;

        if (!title || !body) {
            return res.status(400).json({ success: false, message: "Title and Body are required." });
        }

        const executeQueryWithRetry = async (query, params = [], retries = 2) => {
            let lastError;
            for (let i = 0; i <= retries; i++) {
                let conn;
                try {
                    conn = await pool.getConnection();
                    const [rows] = await conn.query(query, params);
                    return rows;
                } catch (err) {
                    lastError = err;
                    if (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST') {
                        console.warn(`⚠️ [Database] Connection lost, retrying (${i + 1}/${retries})...`);
                        if (conn) conn.destroy(); // Ensure the broken connection is removed
                        continue;
                    }
                    throw err; // For other errors, don't retry
                } finally {
                    if (conn) conn.release();
                }
            }
            throw lastError;
        };

        try {
            let tokens = [];

            if (target === 'specific') {
                if (!userId) return res.status(400).json({ success: false, message: "userId is required for target 'specific'." });

                const table = isDriver ? 'drivers' : 'users';
                const idField = isDriver ? 'id' : 'User_ID_Pk';

                const rows = await executeQueryWithRetry(`SELECT fcm_token FROM ${table} WHERE ${idField} = ? AND fcm_token IS NOT NULL AND fcm_token != ''`, [userId]);
                if (rows.length > 0) tokens.push(rows[0].fcm_token);
            }
            else if (target === 'role') {
                if (!role) return res.status(400).json({ success: false, message: "role is required for target 'role'." });

                if (role.toLowerCase() === 'rider' || role.toLowerCase() === 'user') {
                    const rows = await executeQueryWithRetry("SELECT fcm_token FROM users WHERE fcm_token IS NOT NULL AND fcm_token != ''");
                    tokens.push(...rows.map(r => r.fcm_token));
                } else if (role.toLowerCase() === 'driver') {
                    const rows = await executeQueryWithRetry("SELECT fcm_token FROM drivers WHERE fcm_token IS NOT NULL AND fcm_token != ''");
                    tokens.push(...rows.map(r => r.fcm_token));
                } else {
                    return res.status(400).json({ success: false, message: "Invalid role. Use 'rider' or 'driver'." });
                }
            }
            else if (target === 'all') {
                const userRows = await executeQueryWithRetry("SELECT fcm_token FROM users WHERE fcm_token IS NOT NULL AND fcm_token != ''");
                const driverRows = await executeQueryWithRetry("SELECT fcm_token FROM drivers WHERE fcm_token IS NOT NULL AND fcm_token != ''");
                tokens.push(...userRows.map(r => r.fcm_token));
                tokens.push(...driverRows.map(r => r.fcm_token));
            }
            else {
                return res.status(400).json({ success: false, message: "Invalid target. Use 'all', 'role', or 'specific'." });
            }

            // Remove duplicates and nulls
            const uniqueTokens = [...new Set(tokens.filter(t => t))];

            if (uniqueTokens.length === 0) {
                return res.json({ success: true, message: "No valid FCM tokens found for the specified target.", sentCount: 0 });
            }

            console.log(`🔔 [Admin Notification] Sending to ${uniqueTokens.length} devices. Target: ${target}`);

            // Send to each device
            // Note: For very large sets (1000+), batch processing or multicast would be better.
            // But for current scale, individual sends are fine.
            const sendPromises = uniqueTokens.map(token =>
                pushNotificationService.sendPushToDevice(token, title, body, data)
            );

            await Promise.all(sendPromises);

            res.json({
                success: true,
                message: `Notification process completed.`,
                target,
                deviceCount: uniqueTokens.length
            });

        } catch (err) {
            console.error("Admin Notification Error:", err);
            res.status(500).json({ success: false, message: "Server error while sending notifications.", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = notificationController;
