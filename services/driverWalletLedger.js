// Caller must hold the ride row lock and keep this write in the completion
// transaction. The reference prevents a retried completion from charging twice.
async function debitDriverForRide(conn, { rideId, driverId, amount }) {
    const number = Number(amount);
    if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(Math.round(number * 100))) {
        throw new Error('Invalid driver ride deduction amount');
    }
    const deduction = Math.round((number + Number.EPSILON) * 100) / 100;
    if (deduction === 0) return { deducted: 0, already_applied: false };
    const reference = `RIDE_DEBIT_${rideId}`;
    const [existing] = await conn.query(
        "SELECT amount, transaction_type, status FROM driver_wallet WHERE driver_id = ? AND reference_id = ? LIMIT 1",
        [driverId, reference]
    );
    if (existing.length) {
        const row = existing[0];
        if (row.transaction_type !== 'debit' || row.status !== 'completed' || Math.round(Number(row.amount) * 100) !== Math.round(deduction * 100)) {
            throw new Error('Conflicting driver ride deduction record');
        }
        return { deducted: deduction, already_applied: true };
    }
    await conn.query(
        `INSERT INTO driver_wallet (driver_id, transaction_type, amount, description, reference_id, payment_method, status, created_at)
         VALUES (?, 'debit', ?, ?, ?, 'other', 'completed', NOW())`,
        [driverId, deduction, `Wallet deduction for Ride #${rideId}`, reference]
    );
    return { deducted: deduction, already_applied: false };
}
module.exports = { debitDriverForRide };
