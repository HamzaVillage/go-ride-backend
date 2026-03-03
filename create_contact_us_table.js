const pool = require('./db/Connect_Db');

const createTable = async () => {
    let conn;
    try {
        conn = await pool.getConnection();
        console.log('Connected to DB');

        // Create table
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS contact_us_info (
                id INT AUTO_INCREMENT PRIMARY KEY,
                address TEXT NOT NULL,
                phone VARCHAR(50) NOT NULL,
                email VARCHAR(100) NOT NULL,
                is_active TINYINT DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;
        await conn.query(createTableQuery);
        console.log('✅ Table contact_us_info created or already exists');

        // Check if any data exists
        const [rows] = await conn.query('SELECT COUNT(*) as count FROM contact_us_info');
        if (rows[0].count === 0) {
            // Seed initial data
            const seedQuery = `
                INSERT INTO contact_us_info (address, phone, email, is_active) VALUES 
                ('Office# 72, Road# 21, PECHS, Shahrah e Faisal, Karachi, Pakistan', '+92 321 1234567', 'info@goride.com', 1),
                ('Main Branch, Gulshan-e-Iqbal, Karachi, Pakistan', '+92 300 9876543', 'support@goride.com', 0);
            `;
            await conn.query(seedQuery);
            console.log('✅ Initial data seeded');
        } else {
            console.log('ℹ️ Table already has data, skipping seed');
        }

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        if (conn) conn.release();
        process.exit();
    }
};

createTable();
