const mysql = require("mysql2/promise");
require("dotenv").config();

const Connect_Db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10, // max idle connections, the default value is the same as `connectionLimit`
    idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: '+05:00'
});

// Test connection
(async () => {
    try {


        const connection = await Connect_Db.getConnection();
        console.log("✅ MySQL Connected");
        connection.release();
    } catch (err) {
        console.error("❌ DB Connection Failed:", err.message);
    }
})();

module.exports = Connect_Db;
