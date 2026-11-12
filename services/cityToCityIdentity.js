const { fail } = require('./cityToCityDrivers');
const phoneOf = value => {
    let phone = String(value || '').replace(/\D/g, '');
    if (phone.startsWith('92') && phone.length === 12) phone = `0${phone.slice(2)}`;
    return /^03\d{9}$/.test(phone) ? phone : null;
};
const denied = role => ['admin','superadmin','employee'].includes(String(role || '').trim().toLowerCase());
async function resolveCityToCityIdentity(pool, claims) {
    if (denied(claims.role)) throw Object.assign(fail(403, 'Use your rider or driver account to enroll.'), { code: 'PERSONAL_ACCOUNT_REQUIRED' });
    const id = Number(claims.userId || claims.User_ID_Pk || claims.id);
    const phone = phoneOf(claims.phone || claims.Mobile);
    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.query('SELECT User_ID_Pk, Mobile, Role, AccountDeleted FROM users WHERE User_ID_Pk=?', [Number.isSafeInteger(id) && id > 0 ? id : 0]);
        let owner = rows[0];
        // Some legacy driver tokens contain a driver-row ID. Resolve only using
        // the phone in the verified JWT, never a phone/ID supplied in the body.
        if ((!owner || (phone && phoneOf(owner.Mobile) !== phone)) && phone) {
            const [matches] = await conn.query("SELECT User_ID_Pk,Mobile,Role,AccountDeleted FROM users WHERE REPLACE(REPLACE(REPLACE(Mobile,'-',''),' ',''),'+','') IN (?,?) LIMIT 2", [phone, `92${phone.slice(1)}`]);
            if (matches.length !== 1) throw Object.assign(fail(401, 'Please sign in again to continue enrollment.'), { code: 'SESSION_ACCOUNT_MISSING' });
            owner = matches[0];
        }
        if (!owner) throw Object.assign(fail(401, 'Please sign in again to continue enrollment.'), { code: 'SESSION_ACCOUNT_MISSING' });
        if (Number(owner.AccountDeleted)) throw Object.assign(fail(403, 'This account is inactive. Please contact support.'), { code: 'ACCOUNT_INACTIVE' });
        if (denied(owner.Role)) throw Object.assign(fail(403, 'Use your rider or driver account to enroll.'), { code: 'PERSONAL_ACCOUNT_REQUIRED' });
        return { ...claims, userId: owner.User_ID_Pk, phone: owner.Mobile };
    } finally { conn.release(); }
}
module.exports = { resolveCityToCityIdentity, phoneOf };
