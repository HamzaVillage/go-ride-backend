const { DOCUMENTS } = require('./adminDriverProfiles');
const { formatDriverCode, getDriverWalletBalance } = require('../utils/driverHelper');
const STATUSES = ['unverified', 'pending', 'active', 'inactive', 'blocked'];
const METHODS = ['cash', 'easypaisa', 'jazzcash', 'bank_transfer', 'other'];
const fail = (status, message) => Object.assign(new Error(message), { status });
function positiveInteger(value, fallback, max = 2147483647) {
    if (value === undefined && fallback !== undefined) return fallback;
    if (!['string', 'number'].includes(typeof value)) throw fail(400, 'Invalid page, limit, or driver ID.');
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw fail(400, 'Invalid page, limit, or driver ID.');
    return Number(value);
}
function pagination(query = {}) {
    const page = positiveInteger(query.page, 1, 1000000);
    const limit = positiveInteger(query.limit, 20, 100);
    return { page, limit, offset: (page - 1) * limit };
}
function amountInPaisa(value) {
    if (!['string', 'number'].includes(typeof value) || !/^\d{1,8}(?:\.\d{1,2})?$/.test(String(value))) throw fail(400, 'Enter a positive PKR amount with at most two decimal places.');
    const [whole, fraction = ''] = String(value).split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (cents <= 0 || cents > 9999999999) throw fail(400, 'Top-up amount must be between PKR 0.01 and 99,999,999.99.');
    return cents;
}
const balanceSql = `(SELECT COALESCE(SUM(CASE WHEN w.transaction_type = 'credit' THEN w.amount ELSE -w.amount END), 0)
    FROM driver_wallet w WHERE w.driver_id = d.id AND w.status = 'completed')`;
const columns = `d.id, d.User_ID_FK AS user_id, d.full_name AS name, d.phone, d.email, d.city,
    d.vehicle_type, d.vehicle_model AS vehicle, d.vehicle_number AS plate, d.Rating AS rating, d.cnic,
    SHA2(COALESCE(d.photo_path, ''), 256) AS photo_version,
    ${DOCUMENTS.map(doc => `(CASE WHEN d.${doc.column} IS NOT NULL AND LENGTH(TRIM(d.${doc.column})) > 0 THEN 1 ELSE 0 END) AS has_${doc.key}`).join(', ')},
    LOWER(d.status) AS status, d.Is_Online AS is_online, d.Is_Available AS is_available,
    d.join_date AS joined, d.created_at, d.completed_rides_count AS completed_rides, ${balanceSql} AS wallet_balance`;
const normalizeDriver = row => ({ ...row, driver_code: formatDriverCode(row.id), wallet_balance: Number(row.wallet_balance || 0),
    document_summary: Object.fromEntries(DOCUMENTS.map(doc => [doc.key, Boolean(Number(row[`has_${doc.key}`]))])),
    rating: row.rating == null ? null : Number(row.rating), is_online: Boolean(Number(row.is_online)), is_available: Boolean(Number(row.is_available)) });
const normalizeTxn = row => ({ ...row, amount: Number(row.amount) });
function createAdminDriversService(pool) {
    return {
        async list(query = {}) {
            const { page, limit, offset } = pagination(query);
            const status = query.status || 'all'; const online = query.online || 'all';
            if (typeof status !== 'string' || (status !== 'all' && !STATUSES.includes(status))) throw fail(400, 'Invalid driver status.');
            if (!['all', 'online', 'offline'].includes(online)) throw fail(400, 'Invalid online filter.');
            if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 100)) throw fail(400, 'Search must be at most 100 characters.');
            const filters = []; const params = [];
            if (status !== 'all') { filters.push('LOWER(d.status) = ?'); params.push(status); }
            if (online !== 'all') { filters.push('COALESCE(d.Is_Online, 0) = ?'); params.push(online === 'online' ? 1 : 0); }
            const q = (query.q || '').trim();
            if (q) {
                const like = `%${q.replace(/[=%_]/g, c => `=${c}`)}%`;
                filters.push(`(d.full_name LIKE ? ESCAPE '=' OR d.phone LIKE ? ESCAPE '=' OR d.email LIKE ? ESCAPE '=' OR d.city LIKE ? ESCAPE '=' OR d.vehicle_number LIKE ? ESCAPE '=' OR CONCAT('GRD-', 1000 + d.id) LIKE ? ESCAPE '=' OR CAST(d.id AS CHAR) = ?)`);
                params.push(like, like, like, like, like, like, q);
            }
            const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
            let conn;
            try {
                conn = await pool.getConnection();
                const [counts] = await conn.query(`SELECT COUNT(*) AS total FROM drivers d ${where}`, params);
                const [rows] = await conn.query(`SELECT ${columns} FROM drivers d ${where} ORDER BY d.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
                return { drivers: rows.map(normalizeDriver), pagination: { page, limit, total: Number(counts[0].total), totalPages: Math.ceil(Number(counts[0].total) / limit) } };
            } finally { if (conn) conn.release(); }
        },
        async wallet(id, query = {}) {
            const driverId = positiveInteger(id); const { page, limit, offset } = pagination(query); let conn;
            try {
                conn = await pool.getConnection();
                const [drivers] = await conn.query(`SELECT ${columns} FROM drivers d WHERE d.id = ?`, [driverId]);
                if (!drivers.length) throw fail(404, 'Driver not found.');
                const [count] = await conn.query('SELECT COUNT(*) AS total FROM driver_wallet WHERE driver_id = ?', [driverId]);
                const [transactions] = await conn.query(`SELECT id, transaction_type, amount, description, reference_id, payment_method, status, created_at, created_by
                    FROM driver_wallet WHERE driver_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`, [driverId, limit, offset]);
                return { driver: normalizeDriver(drivers[0]), transactions: transactions.map(normalizeTxn), pagination: {page, limit, total:Number(count[0].total), totalPages:Math.ceil(Number(count[0].total)/limit)} };
            } finally { if (conn) conn.release(); }
        },
        async topup(id, adminId, body = {}, key) {
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Invalid top-up details.');
            const driverId = positiveInteger(id); const actor = positiveInteger(adminId);
            const cents = amountInPaisa(body.amount); const amount = (cents / 100).toFixed(2);
            if (!METHODS.includes(body.payment_method)) throw fail(400, 'Select a valid payment method.');
            if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) throw fail(400, 'Note must be at most 500 characters.');
            if (typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw fail(400, 'A UUID v4 Idempotency-Key header is required.');
            const reference = `ADMIN_TOPUP_${key.toLowerCase()}`;
            const description = `Admin wallet top-up${body.note?.trim() ? `: ${body.note.trim()}` : ''}`;
            let conn; let started = false;
            try {
                conn = await pool.getConnection(); await conn.beginTransaction(); started = true;
                const [admins] = await conn.query("SELECT User_ID_Pk FROM users WHERE User_ID_Pk = ? AND LOWER(TRIM(Role)) = 'admin' AND COALESCE(AccountDeleted, 0) = 0 LOCK IN SHARE MODE", [actor]);
                if (!admins.length) throw fail(403, 'An active admin account is required.');
                // Serialize all top-ups for this driver, including simultaneous retries.
                const [drivers] = await conn.query('SELECT id FROM drivers WHERE id = ? FOR UPDATE', [driverId]);
                if (!drivers.length) throw fail(404, 'Driver not found.');
                const [existing] = await conn.query(`SELECT id, amount, transaction_type, status, payment_method, description, created_by, reference_id
                    FROM driver_wallet WHERE driver_id = ? AND reference_id = ? LIMIT 2 FOR UPDATE`, [driverId, reference]);
                let transactionId; let duplicate = false;
                if (existing.length) {
                    const previous = existing[0];
                    if (existing.length !== 1 || previous.transaction_type !== 'credit' || previous.status !== 'completed' ||
                        Math.round(Number(previous.amount) * 100) !== cents || previous.payment_method !== body.payment_method ||
                        previous.description !== description || Number(previous.created_by) !== actor) throw fail(409, 'This top-up request key has already been used with different details.');
                    transactionId = previous.id; duplicate = true;
                } else {
                    const [inserted] = await conn.query(`INSERT INTO driver_wallet
                        (driver_id, transaction_type, amount, description, reference_id, payment_method, status, created_by, created_at)
                        VALUES (?, 'credit', ?, ?, ?, ?, 'completed', ?, NOW())`, [driverId, amount, description, reference, body.payment_method, actor]);
                    transactionId = inserted.insertId;
                }
                const balance = await getDriverWalletBalance(conn, driverId, null, {strict:true});
                await conn.commit(); started = false;
                return { driver_id: driverId, transaction_id: transactionId, reference_id: reference, credited_amount: Number(amount), wallet_balance: balance, already_applied: duplicate };
            } catch (err) { if (started) { try { await conn.rollback(); } catch { /* Preserve original failure. */ } } throw err; }
            finally { if (conn) conn.release(); }
        },
    };
}
module.exports = { createAdminDriversService, amountInPaisa, pagination };
