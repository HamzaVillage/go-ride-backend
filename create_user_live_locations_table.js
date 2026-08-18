const pool = require('./db/Connect_Db');

async function createUserLiveLocationsTable() {
    let conn;
    try {
        conn = await pool.getConnection();
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS \`user_live_locations\` (
                \`id\` INT(11) NOT NULL AUTO_INCREMENT,
                \`user_id\` INT(11) NOT NULL,
                \`role\` VARCHAR(20) DEFAULT 'rider',
                \`latitude\` DECIMAL(10, 8) NOT NULL,
                \`longitude\` DECIMAL(11, 8) NOT NULL,
                \`heading\` DECIMAL(6, 2) DEFAULT NULL,
                \`speed\` DECIMAL(6, 2) DEFAULT NULL,
                \`accuracy\` DECIMAL(6, 2) DEFAULT NULL,
                \`battery_level\` INT(3) DEFAULT NULL,
                \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`uniq_user_id\` (\`user_id\`),
                KEY \`idx_updated_at\` (\`updated_at\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;
        await conn.query(createTableQuery);
        console.log('✅ [DB] `user_live_locations` table verified/created successfully.');
    } catch (err) {
        console.error('❌ Error creating user_live_locations table:', err.message);
    } finally {
        if (conn) conn.release();
    }
}

if (require.main === module) {
    createUserLiveLocationsTable().then(() => process.exit(0));
}

module.exports = { createUserLiveLocationsTable };
