const { cache } = require('../services/redisCache');
const { isChatEnabled } = require('../services/rideChatService');
const pool = require('../db/Connect_Db');

const sysConfigController = {
    getConfig: async (req, res) => {
        let conn;
        try {
            const query = `
                SELECT 
                    ride_service, 
                    courier_service, 
                    food_delivery_service, 
                    grocery_service, 
                    fare_increaser,
                    dispatch_min_radius_km,
                    dispatch_radius_km
                FROM sysconfigsetup 
                WHERE SCS_ID_Pk = 1
            `;
            const rows = await cache.remember('sysconfig:public', 5, async () => {
                conn = await pool.getConnection();
                const [result] = await conn.query(query);
                return result;
            });

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Configuration not found"
                });
            }

            res.json({
                success: true,
                data: { ...rows[0], ride_chat_enabled: isChatEnabled() }
            });
        } catch (err) {
            console.error("Get Config Error:", err);
            res.status(500).json({
                success: false,
                message: "Error fetching configuration",
                error: err.message
            });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = sysConfigController;
