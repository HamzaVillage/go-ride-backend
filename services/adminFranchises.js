const crypto=require('node:crypto');
const {getAccess}=require('./employeeAccess');
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
const numbers={franchise_fee:[0,9999999999999.99],royalty_fee:[0,100],marketing_fee:[0,100],minimum_capital_required:[0,9999999999999.99],year_established:[1901,2155,true],number_of_locations:[0,2147483647,true],total_employees:[0,2147483647,true],contract_term_years:[0,100,true],renewal_option_years:[0,100,true]};
const editable={...numbers,status:20,profile_complete:0,company_name:250,legal_name:255,contact_person:50,email:250,phone:50,alternate_phone:50,website:255,address:255,address_line2:255,city:100,area:50,state:100,postal_code:20,country:100,registration_number:100,tax_id:100,industry_type:100,business_description:4000,notes:4000};
const versionOf=row=>crypto.createHash('sha256').update(JSON.stringify([row.updated_at,...Object.keys(editable).map(key=>row[key])])).digest('hex');
function normalize(row) {
    const result = { ...row, profile_complete: Boolean(Number(row.profile_complete)) };
    for (const key of ['id', 'driver_count', 'rider_count', 'created_at', 'updated_at', 'year_established', 'number_of_locations', 'total_employees', 'franchise_fee', 'royalty_fee', 'marketing_fee', 'minimum_capital_required', 'contract_term_years', 'renewal_option_years']) {
        if (key in row) result[key] = row[key] == null ? null : Number(row[key]);
    }
    return {...result,version:versionOf(result)};
}
function createAdminFranchisesService(pool) {
    return {
        async update(id,actor,body={}) {
            if(!body.changes||typeof body.changes!=='object'||Array.isArray(body.changes)||!Object.keys(body.changes).length)throw fail(400,'Choose profile changes.');
            const changes={};for(const [key,value]of Object.entries(body.changes)){
                if(!Object.hasOwn(editable,key))throw fail(400,`Invalid ${key}.`);
                if(numbers[key]){if(value===''||value===null){changes[key]=null;continue;}const [min,max,integer]=numbers[key];if(!['string','number'].includes(typeof value)||!Number.isFinite(Number(value))||Number(value)<min||Number(value)>max||(integer&&!Number.isInteger(Number(value)))||Math.abs(Number(value)*100-Math.round(Number(value)*100))>0.00001)throw fail(400,`Invalid ${key}.`);changes[key]=Number(value);continue;}
                if(key==='profile_complete'){if(typeof value!=='boolean')throw fail(400,'Profile completion must be true or false.');changes[key]=Number(value);continue;}
                if(typeof value!=='string'||value.length>editable[key])throw fail(400,`Invalid ${key}.`);
                if(key==='status'&&!STATUSES.includes(value))throw fail(400,'Invalid franchise status.');
                if(key==='company_name'&&!value.trim())throw fail(400,'Company name is required.');
                if(key==='email'&&value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw fail(400,'Enter a valid email.');
                changes[key]=value.trim()||null;
            }
            if(!/^[1-9]\d*$/.test(String(id))||Number(id)>2147483647)throw fail(400,'Invalid franchise ID.');
            const conn=await pool.getConnection();try{
                await conn.beginTransaction();const access=await getAccess(conn,actor,{lock:true});if(!access.functions.includes('franchises'))throw fail(403,'Franchise screen access is required.');
                const [rows]=await conn.query(`SELECT ${summary}, ${details} FROM franchiser f WHERE f.id=? FOR UPDATE`,[Number(id)]);if(!rows.length)throw fail(404,'Franchise not found.');
                if(normalize(rows[0]).version!==body.version)throw fail(409,'This franchise changed elsewhere. Reopen its latest details.');
                await conn.query(`UPDATE franchiser SET ${Object.keys(changes).map(k=>`${k}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`,[...Object.values(changes),Number(id)]);
                await conn.commit();console.info('Admin franchise profile updated',{adminId:actor,franchiseId:Number(id)});return {id:Number(id)};
            }catch(e){await conn.rollback().catch(()=>{});throw e;}finally{conn.release();}
        },
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
