const pool = require('../db/Connect_Db');

const sysConfigController = {
    getConfig: async (req, res) => {
        let conn;
        try {
            conn = await pool.getConnection();
            const query = `
                SELECT 
                    ride_service, 
                    courier_service, 
                    food_delivery_service, 
                    grocery_service, 
                    fare_increaser 
                FROM sysconfigsetup 
                WHERE SCS_ID_Pk = 1
            `;
            const [rows] = await conn.query(query);

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Configuration not found"
                });
            }

            res.json({
                success: true,
                data: rows[0]
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
