const { includedPlatformFee } = require('../services/platformFee');
async function configure(pool, { apply = false } = {}) {
    const [columns] = await pool.query('SHOW COLUMNS FROM vehicle_fare_rate');
    const has = name => columns.some(column => column.Field === name);
    if (!has('Fee_Percentage')) throw new Error('Existing vehicle fare table is missing Fee_Percentage.');
    if (!apply) return { read_only: true, mode_column_present: has('Platform_Fee_Is_Percentage'), fixed_fee_present: has('Platform_Fee_RS'), message: 'Use --apply to add missing fee columns. Existing prices and wallet history are preserved.' };
    if (!has('Platform_Fee_RS')) await pool.query('ALTER TABLE vehicle_fare_rate ADD COLUMN Platform_Fee_RS DECIMAL(10,2) NOT NULL DEFAULT 0');
    if (!has('Platform_Fee_Is_Percentage')) await pool.query('ALTER TABLE vehicle_fare_rate ADD COLUMN Platform_Fee_Is_Percentage TINYINT(1) NOT NULL DEFAULT 1');
    const [rates] = await pool.query('SELECT Fee_Percentage,Platform_Fee_RS,Platform_Fee_Is_Percentage FROM vehicle_fare_rate');
    for (const rate of rates) includedPlatformFee(rate, Math.max(1000000, Number(rate.Platform_Fee_RS)));
    return { configured: true, default_mode: 'percentage', existing_wallets_changed: false };
}
if (require.main === module) {
    if (!process.argv.includes('--apply')) console.log('Read-only schema check. No balances or historical rides will be changed.');
    const pool = require('../db/Connect_Db');
    configure(pool, { apply: process.argv.includes('--apply') }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { configure };
