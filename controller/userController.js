const pool = require('../db/Connect_Db');

const userController = {
    getProfile: async (req, res) => {
        const userId = req.user.userId;

        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query("SELECT User_ID_Pk, User_Name, Email, Mobile, Role, Cnic, Address, City FROM users WHERE User_ID_Pk = ?", [userId]);

            if (rows.length === 0) return res.status(404).json({ success: false, message: "User not found" });

            res.json({ success: true, data: rows[0] });
        } catch (err) {
            console.error("Get Profile Error:", err);
            res.status(500).json({ success: false, message: "Error fetching profile", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    updateProfile: async (req, res) => {
        const userId = req.user.userId;
        const { full_name, email, cnic, address, city } = req.body;

        let conn;
        try {
            conn = await pool.getConnection();
            await conn.query(
                "UPDATE users SET User_Name = ?, Email = ?, Cnic = ?, Address = ?, City = ? WHERE User_ID_Pk = ?",
                [full_name, email, cnic, address, city, userId]
            );

            res.json({ success: true, message: "Profile updated successfully" });
        } catch (err) {
            console.error("Update Profile Error:", err);
            res.status(500).json({ success: false, message: "Error updating profile", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    updateFcmToken: async (req, res) => {
        const userId = req.user.userId;
        const role = req.user.role;
        const phone = req.user.phone;
        const { fcm_token } = req.body;

        if (!fcm_token || typeof fcm_token !== 'string' || !fcm_token.trim()) {
            return res.status(400).json({ success: false, message: "fcm_token is required" });
        }

        const token = fcm_token.trim();
        let conn;
        try {
            conn = await pool.getConnection();
            await conn.query(
                "UPDATE users SET fcm_token = ?, fcm_token_updated_at = CURRENT_TIMESTAMP WHERE User_ID_Pk = ?",
                [token, userId]
            );

            if (role === 'driver' && phone) {
                const normalizedPhone = String(phone).replace(/-/g, '');
                const [driverRows] = await conn.query(
                    "SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = ?",
                    [normalizedPhone]
                );
                if (driverRows.length > 0) {
                    await conn.query(
                        "UPDATE drivers SET fcm_token = ?, fcm_token_updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        [token, driverRows[0].id]
                    );
                    console.log('🔔 [FCM] Token saved for driver id=', driverRows[0].id);
                }
            }

            console.log('🔔 [FCM] Token saved for userId=', userId, 'tokenPreview=', token.slice(0, 8) + '...' + token.slice(-8));
            res.json({ success: true, message: "FCM token updated" });
        } catch (err) {
            console.error("Update FCM Token Error:", err);
            res.status(500).json({ success: false, message: "Error updating FCM token", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = userController;
