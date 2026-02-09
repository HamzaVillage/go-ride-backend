const pool = require('./db/Connect_Db');

(async () => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query("SELECT NOW() as mysql_now, @@global.time_zone, @@session.time_zone");
        console.log("MySQL Time and Timezone:");
        console.table(rows);
        console.log("Node.js Time:", new Date().toString());
        console.log("Node.js ISO Time:", new Date().toISOString());
    } catch (err) {
        console.error("Error fetching time:", err);
    } finally {
        if (conn) conn.release();
        process.exit();
    }
})();
