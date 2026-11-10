const fs = require('node:fs/promises');
const path = require('node:path');
const file = path.join(__dirname, '../db/migrations/add_admin_settings.sql');
async function main() {
    if (!process.argv.includes('--apply')) { console.log(`Review migration: ${file}`); console.log('No database changes made. Run npm run setup:admin-settings -- --apply against the intended database.'); return; }
    const pool = require('../db/Connect_Db'); let conn;
    try {
        conn = await pool.getConnection();
        for (const [table, required] of Object.entries({ sysconfigsetup: ['SCS_ID_Pk', 'dispatch_min_radius_km', 'dispatch_radius_km'], vehicle_fare_rate: ['Rate_ID_Pk', 'Fee_Percentage', 'rides_limit', 'rides_over_limit_count'] })) {
            const [columns] = await conn.query(`SHOW COLUMNS FROM ${table}`);
            if (required.some(key => !columns.some(column => column.Field === key))) throw new Error(`Upgrade the existing ${table} schema before installing settings.`);
            const [engines] = await conn.query('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]);
            if (String(engines[0]?.ENGINE).toLowerCase() !== 'innodb') throw new Error(`${table} must use InnoDB for transactional settings updates. Review an engine migration first.`);
        }
        const sql = (await fs.readFile(file, 'utf8')).replace(/^\s*--.*$/gm, '');
        for (const statement of sql.split(';').map(item => item.trim()).filter(Boolean)) await conn.query(statement);
        console.log('Admin settings migration installed. Existing vehicle/service values were preserved. Restart the API with the updated code.');
    } finally { conn?.release(); await pool.end(); }
}
main().catch(error => { console.error('Admin settings setup failed:', error.code || error.message); process.exitCode = 1; });
