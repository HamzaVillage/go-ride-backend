const { pagination } = require('./adminDrivers');
const fail = message => Object.assign(new Error(message), { status: 400 });
function filters(query, fields, statuses, statusSql) {
    const paging = pagination(query);
    if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 100)) throw fail('Search must be at most 100 characters.');
    const status = query.status === undefined ? 'all' : query.status;
    if (typeof status !== 'string' || (status !== 'all' && !statuses.includes(status))) throw fail('Invalid status filter.');
    const clauses = [], params = [], q = (query.q || '').trim();
    if (q) {
        const like = `%${q.replace(/[=%_]/g, value => `=${value}`)}%`;
        clauses.push(`(${fields.map(field => `${field} LIKE ? ESCAPE '='`).join(' OR ')})`);
        params.push(...fields.map(() => like));
    }
    if (status !== 'all') { clauses.push(`${statusSql} = ?`); params.push(status); }
    return { ...paging, clauses, params };
}
async function readPage(pool, spec, options) {
    const { page, limit, offset, clauses, params } = options;
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    let conn;
    try {
        conn = await pool.getConnection();
        const [counts] = await conn.query(`SELECT COUNT(*) AS total FROM ${spec.from} ${where}`, params);
        const [rows] = await conn.query(`SELECT ${spec.columns} FROM ${spec.from} ${where} ORDER BY ${spec.order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
        const total = Number(counts[0].total);
        return { [spec.key]: rows.map(spec.normalize || (row => row)), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    } finally { if (conn) conn.release(); }
}
function createAdminDirectoriesService(pool) {
    return {
        rides(query = {}) {
            const options = filters(query, ['CAST(r.Ride_ID_Pk AS CHAR)', 'u.User_Name', 'd.full_name', 'r.Pickup_Location', 'r.Drop_Location'], ['requested', 'accepted', 'arrived', 'started', 'completed', 'cancelled', 'rejected'], 'LOWER(r.Ride_Status)');
            return readPage(pool, {
                key: 'rides', from: 'ride_history r LEFT JOIN users u ON u.User_ID_Pk = r.User_ID_Fk LEFT JOIN drivers d ON d.id = r.Driver_ID_Fk',
                columns: `r.Ride_ID_Pk AS id, r.User_ID_Fk AS rider_id, r.Driver_ID_Fk AS driver_id, u.User_Name AS rider, d.full_name AS driver,
                    r.Pickup_Location AS pickup, r.Drop_Location AS destination, r.Fare AS fare, LOWER(r.Ride_Status) AS status,
                    r.Payment_Method AS payment_method, r.Vehicle_Type AS vehicle_type, UNIX_TIMESTAMP(r.Ride_Date) * 1000 AS ride_at`,
                order: 'r.Ride_Date DESC, r.Ride_ID_Pk DESC',
                normalize: row => ({ ...row, rider: row.rider || 'Unavailable rider', driver: row.driver || 'Not assigned', fare: Number(row.fare || 0), ride_at: row.ride_at == null ? null : Number(row.ride_at) }),
            }, options);
        },
        riders(query = {}) {
            const options = filters(query, ['CAST(u.User_ID_Pk AS CHAR)', 'u.User_Name', 'u.Mobile', 'u.Email', 'u.City'], ['active', 'deleted'], "CASE WHEN COALESCE(u.AccountDeleted, 0) = 0 THEN 'active' ELSE 'deleted' END");
            options.clauses.unshift("LOWER(TRIM(COALESCE(u.Role, ''))) IN ('rider', 'user', 'customer', '')");
            return readPage(pool, {
                key: 'riders', from: 'users u',
                columns: `u.User_ID_Pk AS id, u.User_Name AS name, u.Mobile AS phone, u.Email AS email, u.City AS city,
                    UNIX_TIMESTAMP(u.Create_Date) * 1000 AS joined_at,
                    CASE WHEN COALESCE(u.AccountDeleted, 0) = 0 THEN 'active' ELSE 'deleted' END AS status,
                    (SELECT COUNT(*) FROM ride_history r WHERE r.User_ID_Fk = u.User_ID_Pk) AS trips`,
                order: 'u.User_ID_Pk DESC', normalize: row => ({ ...row, trips: Number(row.trips || 0), joined_at: row.joined_at == null ? null : Number(row.joined_at) }),
            }, options);
        },
        async support(query = {}) {
            // Complaint deployments predate the schema dump; only use verified, allowlisted metadata.
            const options = filters(query, ['c.full_name', 'c.mobile_number', 'c.category', 'c.issue_description', 'CAST(c.user_id AS CHAR)'], [], "'submitted'");
            const [columns] = await pool.query('SHOW COLUMNS FROM complaints');
            const available = new Set(columns.map(column => column.Field));
            const id = ['id', 'complaint_id', 'Complaint_ID_Pk'].find(column => available.has(column));
            if (!id) throw new Error('Unsupported complaints schema');
            const date = ['created_at', 'CreatedAt', 'created_on', 'submitted_at'].find(column => available.has(column));
            const status = ['status', 'complaint_status'].find(column => available.has(column));
            return readPage(pool, {
                key: 'queries', from: 'complaints c',
                columns: `c.${id} AS id, c.user_id, c.full_name AS name, c.mobile_number AS phone, c.category,
                    c.issue_description AS message, ${status ? `c.${status}` : "'submitted'"} AS status,
                    ${date ? `UNIX_TIMESTAMP(c.${date}) * 1000` : 'NULL'} AS created_at`,
                order: `c.${id} DESC`, normalize: row => ({ ...row, created_at: row.created_at == null ? null : Number(row.created_at) }),
            }, options);
        },
    };
}
module.exports = { createAdminDirectoriesService };
