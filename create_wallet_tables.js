const pool = require('./db/Connect_Db');

async function createWalletTables() {
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Create user_wallets table
        const createUserWalletsTable = `
            CREATE TABLE IF NOT EXISTS \`user_wallets\` (
                \`id\` INT(11) NOT NULL AUTO_INCREMENT,
                \`user_id\` INT(11) NOT NULL,
                \`balance\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                \`currency\` VARCHAR(10) NOT NULL DEFAULT 'PKR',
                \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`uniq_user_wallet_user_id\` (\`user_id\`),
                KEY \`idx_user_wallet_balance\` (\`balance\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;
        await conn.query(createUserWalletsTable);
        console.log('✅ [DB] `user_wallets` table verified/created.');

        // 2. Create user_wallet_transactions table
        const createUserWalletTransactionsTable = `
            CREATE TABLE IF NOT EXISTS \`user_wallet_transactions\` (
                \`id\` INT(11) NOT NULL AUTO_INCREMENT,
                \`user_id\` INT(11) NOT NULL,
                \`amount\` DECIMAL(10, 2) NOT NULL,
                \`transaction_type\` ENUM('credit', 'debit') NOT NULL,
                \`payment_method\` VARCHAR(50) NOT NULL DEFAULT 'jazzcash',
                \`description\` VARCHAR(255) NOT NULL,
                \`reference_id\` VARCHAR(100) DEFAULT NULL,
                \`ride_id\` INT(11) DEFAULT NULL,
                \`status\` ENUM('pending', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'completed',
                \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (\`id\`),
                KEY \`idx_wallet_txn_user_id\` (\`user_id\`),
                KEY \`idx_wallet_txn_reference\` (\`reference_id\`),
                KEY \`idx_wallet_txn_ride_id\` (\`ride_id\`),
                KEY \`idx_wallet_txn_created_at\` (\`created_at\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;
        await conn.query(createUserWalletTransactionsTable);
        console.log('✅ [DB] `user_wallet_transactions` table verified/created.');

        // 3. Ensure driver_wallet table exists or has correct columns
        const createDriverWalletTable = `
            CREATE TABLE IF NOT EXISTS \`driver_wallet\` (
                \`id\` INT(11) NOT NULL AUTO_INCREMENT,
                \`driver_id\` INT(11) NOT NULL,
                \`transaction_type\` ENUM('credit', 'debit') NOT NULL,
                \`amount\` DECIMAL(10, 2) NOT NULL,
                \`description\` TEXT DEFAULT NULL,
                \`reference_id\` VARCHAR(100) DEFAULT NULL,
                \`payment_method\` ENUM('cash', 'easypaisa', 'jazzcash', 'bank_transfer', 'wallet', 'other') DEFAULT 'wallet',
                \`status\` ENUM('pending', 'completed', 'cancelled') DEFAULT 'completed',
                \`transaction_date\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                \`created_by\` INT(11) DEFAULT NULL,
                PRIMARY KEY (\`id\`),
                KEY \`idx_driver_wallet_driver\` (\`driver_id\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;
        await conn.query(createDriverWalletTable);
        console.log('✅ [DB] `driver_wallet` table verified/created.');

    } catch (err) {
        console.error('❌ Error creating wallet tables:', err.message);
    } finally {
        if (conn) conn.release();
    }
}

if (require.main === module) {
    createWalletTables().then(() => process.exit(0));
}

module.exports = { createWalletTables };
