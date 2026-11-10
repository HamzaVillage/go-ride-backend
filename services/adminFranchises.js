const { pagination } = require('./adminDrivers');
const STATUSES = ['active', 'inactive', 'pending', 'suspended'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const counts = `(SELECT COUNT(*) FROM drivers d WHERE d.Franchiser_ID_FK = f.id) AS driver_count,
    (SELECT COUNT(*) FROM users u WHERE u.Franchiser_ID_FK = f.id AND COALESCE(u.AccountDeleted, 0) = 0
    AND LOWER(TRIM(COALESCE(u.Role, ''))) IN ('rider', 'user', 'customer', '')) AS rider_count`;
const summary = `f.id, f.company_name, f.contact_person, f.email, f.phone, f.city, f.area,
    f.status, f.profile_complete, UNIX_TIMESTAMP(f.created_at) * 1000 AS created_at, ${counts}`;
const details = `f.legal_name, f.registration_number, f.tax_id, f.alternate_phone, f.website,
    f.address, f.address_line2, f.state, f.postal_code, f.country, f.industry_type,
    f.business_description, f.year_established, f.number_of_locations, f.total_employees,
    f.franchise_fee, f.royalty_fee, f.marketing_fee, f.minimum_capital_required,
    f.contract_term_years, f.renewal_option_years, f.notes, UNIX_TIMESTAMP(f.updated_at) * 1000 AS updated_at`;
function normalize(row) {
    const result = { ...row, profile_complete: Boolean(Number(row.profile_complete)) };
    for (const key of ['id', 'driver_count', 'rider_count', 'created_at', 'updated_at', 'year_established', 'number_of_locations', 'total_employees', 'franchise_fee', 'royalty_fee', 'marketing_fee', 'minimum_capital_required', 'contract_term_years', 'renewal_option_years']) {
        if (key in row) result[key] = row[key] == null ? null : Number(row[key]);
    }
    return result;
}
function createAdminFranchisesService(pool) {
    return {
        async list(query = {}) {
            const { page, limit, offset } = pagination(query);
            if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 100)) throw fail(400, 'Search must be at most 100 characters.');
            const status = query.status === undefined ? 'all' : query.status;
            if (typeof status !== 'string' || (status !== 'all' && !STATUSES.includes(status))) throw fail(400, 'Invalid franchise status.');
            const clauses = [], params = [], search = (query.q || '').trim();
            if (search) {
                const fields = ['CAST(f.id AS CHAR)', 'f.company_name', 'f.legal_name', 'f.contact_person', 'f.email', 'f.phone', 'f.city', 'f.area'];
                const like = `%${search.replace(/[=%_]/g, value => `=${value}`)}%`;
                clauses.push(`(${fields.map(field => `${field} LIKE ? ESCAPE '='`).join(' OR ')})`);
                params.push(...fields.map(() => like));
            }
            if (status !== 'all') { clauses.push('f.status = ?'); params.push(status); }
            const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
            let conn;
            try {
                conn = await pool.getConnection();
                const [count] = await conn.query(`SELECT COUNT(*) AS total FROM franchiser f ${where}`, params);
                const [rows] = await conn.query(`SELECT ${summary} FROM franchiser f ${where} ORDER BY f.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
                const total = Number(count[0].total);
                return { franchises: rows.map(normalize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
            } finally { if (conn) conn.release(); }
        },
        async get(id) {
            if (!['string', 'number'].includes(typeof id) || !/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) throw fail(400, 'Invalid franchise ID.');
            let conn;
            try {
                conn = await pool.getConnection();
                const [rows] = await conn.query(`SELECT ${summary}, ${details} FROM franchiser f WHERE f.id = ?`, [Number(id)]);
                if (!rows.length) throw fail(404, 'Franchise not found.');
                return normalize(rows[0]);
            } finally { if (conn) conn.release(); }
        },
    };
}
module.exports = { createAdminFranchisesService };
