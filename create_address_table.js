const pool = require('./db/Connect_Db');

(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_addresses (
                Address_ID_Pk INT AUTO_INCREMENT PRIMARY KEY,
                User_ID_Fk INT NOT NULL,
                Title VARCHAR(50) NOT NULL COMMENT 'e.g. Home, Office, Other',
                Address TEXT NOT NULL,
                Lat DECIMAL(10,7),
                Lng DECIMAL(10,7),
                City VARCHAR(100),
                Note VARCHAR(255),
                Is_Default TINYINT(1) DEFAULT 0,
                CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('user_addresses table created successfully');
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        process.exit();
    }
})();
