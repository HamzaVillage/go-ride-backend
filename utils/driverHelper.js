/**
 * Helper to generate and parse unchangeable Driver Codes (Option A)
 * Uses driver primary key `id` from MySQL `drivers` table.
 * e.g., driver id 28 -> "GRD-1028"
 */

const formatDriverCode = (driverId) => {
    if (!driverId && driverId !== 0) return null;
    const numId = Number(driverId);
    if (isNaN(numId) || numId <= 0) return null;
    return `GRD-${1000 + numId}`;
};

const parseDriverId = (driverCode) => {
    if (!driverCode) return null;
    const match = String(driverCode).trim().match(/GRD-(\d+)/i);
    if (!match) return null;
    const parsed = Number(match[1]) - 1000;
    return parsed > 0 ? parsed : null;
};

/**
 * Calculate current driver wallet balance from driver_wallet & user_wallets
 */
const getDriverWalletBalance = async (conn, driverId, userIdFk = null) => {
    let wallet_balance = 0.00;
    try {
        const [walletRows] = await conn.query(
            `SELECT 
                COALESCE(SUM(CASE WHEN transaction_type = 'credit' AND status = 'completed' THEN amount ELSE 0 END), 0) -
                COALESCE(SUM(CASE WHEN transaction_type = 'debit' AND status = 'completed' THEN amount ELSE 0 END), 0) as balance
             FROM driver_wallet WHERE driver_id = ?`,
            [driverId]
        );
        wallet_balance = parseFloat(walletRows[0]?.balance || 0);

        if (wallet_balance === 0 && userIdFk) {
            const [userWRows] = await conn.query(
                "SELECT balance FROM user_wallets WHERE user_id = ?",
                [userIdFk]
            );
            if (userWRows.length > 0 && parseFloat(userWRows[0].balance || 0) > 0) {
                wallet_balance = parseFloat(userWRows[0].balance);
            }
        }
    } catch (err) {
        console.warn("Error calculating driver wallet balance:", err.message);
    }
    return parseFloat(wallet_balance.toFixed(2));
};

/**
 * Get dynamic minimum wallet balance limit for a vehicle category from vehicle_fare_rate
 * (reads rides_over_limit_count which holds the required PKR amount, default 300.00)
 */
const getVehicleMinWalletLimit = async (conn, vehicleType) => {
    let minBalance = 300.00;
    if (!vehicleType) return minBalance;
    try {
        const [rows] = await conn.query(
            "SELECT rides_over_limit_count FROM vehicle_fare_rate WHERE LOWER(TRIM(Vehicle_Type)) = LOWER(TRIM(?)) AND Is_Active = 1 LIMIT 1",
            [vehicleType]
        );
        if (rows.length > 0 && Number(rows[0].rides_over_limit_count) > 0) {
            minBalance = parseFloat(rows[0].rides_over_limit_count);
        }
    } catch (err) {
        console.warn("Error fetching vehicle min wallet limit:", err.message);
    }
    return parseFloat(minBalance.toFixed(2));
};

module.exports = {
    formatDriverCode,
    parseDriverId,
    getDriverWalletBalance,
    getVehicleMinWalletLimit,
};
