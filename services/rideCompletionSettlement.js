const { debitDriverForRide } = require('./driverWalletLedger');
const { getDriverWalletBalance, getVehicleMinWalletLimit } = require('../utils/driverHelper');
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

async function completionWalletSummary(conn, ride, deduction) {
    if (deduction === undefined) {
        const [rows] = await conn.query(
            "SELECT amount FROM driver_wallet WHERE driver_id = ? AND reference_id = ? AND transaction_type = 'debit' AND status = 'completed' LIMIT 1",
            [ride.Driver_ID_Fk, `RIDE_DEBIT_${ride.Ride_ID_Pk}`]
        );
        deduction = Number(rows[0]?.amount || 0);
    }
    const balance = await getDriverWalletBalance(conn, ride.Driver_ID_Fk, null, { strict: true });
    const minimum = await getVehicleMinWalletLimit(conn, ride.Vehicle_Type, { strict: true });
    return { driver_wallet_deduction: deduction, wallet_balance: balance, min_wallet_balance: minimum,
        topup_required: balance < minimum, is_wallet_sufficient: balance >= minimum };
}

// Caller holds the ride and assigned driver's InnoDB row locks. All financial
// writes, ride completion and chat deletion must commit or roll back together.
async function settleRideCompletion(conn, ride) {
    const fare = money(ride.Fare);
    const orgFee = money(ride.Organization_Fee || 0);
    if (!Number.isFinite(fare) || fare < 0 || !Number.isFinite(orgFee) || orgFee < 0) throw new Error('Invalid stored ride fare');
    const earning = money(Math.max(0, fare - orgFee));
    let paymentMethod = ride.Payment_Method || 'Cash';
    if (paymentMethod.toLowerCase() === 'wallet' && fare > 0) {
        const [wallets] = await conn.query('SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE', [ride.User_ID_Fk]);
        if (Number(wallets[0]?.balance || 0) >= fare) {
            await conn.query('UPDATE user_wallets SET balance = balance - ? WHERE user_id = ?', [fare, ride.User_ID_Fk]);
            await conn.query(
                `INSERT INTO user_wallet_transactions (user_id, amount, transaction_type, payment_method, description, reference_id, ride_id, status, created_at)
                 VALUES (?, ?, 'debit', 'ride_fare', ?, ?, ?, 'completed', NOW())`,
                [ride.User_ID_Fk, fare, `Payment for Ride #${ride.Ride_ID_Pk}`, `RIDE_PAY_${ride.Ride_ID_Pk}`, ride.Ride_ID_Pk]
            );
            // Preserve existing digital-payment earnings credit. This is separate
            // from the full-fare driver charge below; no second commission debit.
            await conn.query(
                `INSERT INTO driver_wallet (driver_id, transaction_type, amount, description, reference_id, payment_method, status, created_at)
                 VALUES (?, 'credit', ?, ?, ?, 'other', 'completed', NOW())`,
                [ride.Driver_ID_Fk, earning, `Wallet-paid earning for Ride #${ride.Ride_ID_Pk}`, `RIDE_CREDIT_${ride.Ride_ID_Pk}`]
            );
            paymentMethod = 'Wallet';
        } else {
            // Existing behavior: a rider wallet with insufficient funds pays cash.
            paymentMethod = 'Cash';
        }
        if (Object.keys(ride).some(key => key.toLowerCase() === 'payment_status')) {
            await conn.query('UPDATE ride_history SET Payment_Method = ?, Payment_Status = ? WHERE Ride_ID_Pk = ?',
                [paymentMethod, paymentMethod === 'Wallet' ? 'Paid' : 'Unpaid', ride.Ride_ID_Pk]);
        } else {
            await conn.query('UPDATE ride_history SET Payment_Method = ? WHERE Ride_ID_Pk = ?', [paymentMethod, ride.Ride_ID_Pk]);
        }
    }
    const charge = await debitDriverForRide(conn, { driverId: ride.Driver_ID_Fk, rideId: ride.Ride_ID_Pk, amount: fare });
    await conn.query(
        `INSERT INTO driver_earnings (Ride_ID_Fk, Driver_ID_Fk, Total_Fare, Organization_Fee, Driver_Earning, Payment_Method, Vehicle_Type, Earned_At)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [ride.Ride_ID_Pk, ride.Driver_ID_Fk, fare, orgFee, earning, paymentMethod, ride.Vehicle_Type || null]
    );
    await conn.query('UPDATE drivers SET completed_rides_count = COALESCE(completed_rides_count, 0) + 1, driver_earnings_sum = COALESCE(driver_earnings_sum, 0) + ? WHERE id = ?', [earning, ride.Driver_ID_Fk]);
    const [totals] = await conn.query('SELECT completed_rides_count FROM drivers WHERE id = ?', [ride.Driver_ID_Fk]);
    const [rates] = await conn.query('SELECT rides_limit, rides_over_limit_count FROM vehicle_fare_rate WHERE Vehicle_Type = ? AND Is_Active = 1 LIMIT 1', [ride.Vehicle_Type]);
    const count = Number(totals[0]?.completed_rides_count || 0);
    const limit = Number(rates[0]?.rides_limit || 0);
    const over = Number(rates[0]?.rides_over_limit_count || 0);
    if ((limit > 0 && count >= limit) || (over > 0 && limit > 0 && Math.max(0, count - limit) >= over)) {
        await conn.query('UPDATE drivers SET overdue_since = COALESCE(overdue_since, NOW()) WHERE id = ? AND overdue_since IS NULL', [ride.Driver_ID_Fk]);
    }
    return completionWalletSummary(conn, ride, charge.deducted);
}
module.exports = { settleRideCompletion, completionWalletSummary };
