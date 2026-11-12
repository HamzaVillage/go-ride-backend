const fs = require('node:fs/promises');
const path = require('node:path');
const migration = path.join(__dirname, '../db/migrations/add_employee_access.sql');
async function main() {
    if (!process.argv.includes('--apply')) {
        console.log(`Review migration: ${migration}`);
        console.log('No database changes made. Run npm run setup:employee-access -- --apply against the intended database to install it.');
        return;
    }
    const pool = require('../db/Connect_Db');
    let conn;
    try {
        conn = await pool.getConnection();
        // This checked-in migration contains no semicolons inside quoted values.
        const sql = (await fs.readFile(migration, 'utf8')).replace(/^\s*--.*$/gm, '');
        for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await conn.query(statement);
        const required = {
            employee: ['emp_id', 'password_hash', 'account_type', 'name', 'email', 'phone', 'cnic', 'father_name', 'father_cnic', 'address', 'cnic_front', 'cnic_back', 'other_document', 'version'],
            employee_role: ['role_id', 'role_name', 'role_description', 'version'],
            employee_function: ['function_id', 'function_name', 'function_code', 'version'],
            assign_role: ['emp_id', 'role_id'], assign_role_function: ['role_id', 'function_id'],
        };
        for (const [table, columns] of Object.entries(required)) {
            const [rows] = await conn.query(`SHOW COLUMNS FROM ${table}`);
            for (const key of [...columns, 'created_at', 'created_by', 'updated_at', 'updated_by', 'is_active', 'is_deleted']) if (!rows.some(column => column.Field === key)) throw new Error(`${table}.${key} is missing. Existing tables need a reviewed upgrade; leave EMPLOYEE_ACCESS_ENABLED=false.`);
        }
        await require('./separateStaffIdentities').migrate(conn, { apply: true });
        console.log('Employee-access tables and screen catalog installed. Set EMPLOYEE_ACCESS_ENABLED=true and restart the backend.');
        console.log('Create the initial super administrator with setup:staff-admin. Existing installations must run setup:staff-identities before starting this backend.');
    } finally { conn?.release(); await pool.end(); }
}
main().catch(error => { console.error('Employee-access setup failed:', error.code || error.message); process.exitCode = 1; });
