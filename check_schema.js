const pool = require('./db/Connect_Db');

(async () => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query("DESCRIBE ride_history");
        console.log("Table structure for ride_history:");
        console.table(rows);
    } catch (err) {
        console.error("Error fetching schema:", err);
    } finally {
        if (conn) conn.release();
        process.exit();
    }
})();
