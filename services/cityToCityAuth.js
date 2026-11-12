const { createHash, timingSafeEqual } = require('node:crypto');
const { fail } = require('./cityToCityDrivers');
const PURPOSE = 'city_to_city_login';
const digest = value => createHash('sha256').update(value).digest('hex');
function phoneNumber(value) {
    if (typeof value !== 'string') throw fail(400, 'Enter a valid mobile number.');
    let phone = value.replace(/[\s()-]/g, '');
    if (phone.startsWith('+92')) phone = `0${phone.slice(3)}`;
    if (!/^03\d{9}$/.test(phone)) throw fail(400, 'Enter an 11-digit mobile number beginning with 03.');
    return phone;
}
function createCityToCityAuth({ pool, sendOtp, signToken }) {
    async function findOwner(conn, phone) {
        const [rows] = await conn.query("SELECT u.User_ID_Pk, u.User_Name, u.Mobile, u.Email, u.Role, u.AccountDeleted FROM users u JOIN city_to_city_drivers d ON d.user_id=u.User_ID_Pk WHERE REPLACE(REPLACE(u.Mobile,'-',''),' ','')=? ORDER BY u.User_ID_Pk LIMIT 2 FOR UPDATE", [phone]);
        if (rows.length !== 1) throw fail(404, 'City-to-city driver not registered. Sign up or switch from your existing account.');
        const owner = rows[0];
        if (Number(owner.AccountDeleted) || ['admin','superadmin','employee'].includes(String(owner.Role).toLowerCase())) throw fail(403, 'This account cannot sign in here.');
        return owner;
    }
    async function transaction(action) { const conn = await pool.getConnection(); try { await conn.beginTransaction(); const value = await action(conn); await conn.commit(); return value; } catch (error) { await conn.rollback().catch(() => {}); throw error; } finally { conn.release(); } }
    return {
        async send(body) {
            const phone = phoneNumber(body?.phone);
            return transaction(async conn => {
                await findOwner(conn, phone);
                const [recent] = await conn.query('SELECT id FROM otp_verifications WHERE phone_number=? AND purpose=? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)', [phone, PURPOSE]);
                if (recent.length) throw fail(429, 'Please wait one minute before requesting another code.');
                const otp = String(await sendOtp(phone));
                if (!/^\d{6}$/.test(otp)) throw fail(502, 'Unable to send a verification code. Try again.');
                await conn.query('DELETE FROM otp_verifications WHERE phone_number=? AND purpose=?', [phone, PURPOSE]);
                await conn.query('INSERT INTO otp_verifications (phone_number,otp_hash,purpose,expires_at) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))', [phone,digest(otp),PURPOSE]);
                return { message: 'Verification code sent.' };
            });
        },
        async verify(body) {
            const phone = phoneNumber(body?.phone);
            if (typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp)) throw fail(400, 'Enter the 6-digit verification code.');
            // Return validation failure from the transaction so the attempt counter commits.
            const result = await transaction(async conn => {
                const owner = await findOwner(conn, phone);
                const [rows] = await conn.query('SELECT id,otp_hash,attempts FROM otp_verifications WHERE phone_number=? AND purpose=? AND verified=0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE', [phone,PURPOSE]);
                if (!rows.length || Number(rows[0].attempts) >= 5) return { invalid: true };
                const record = rows[0], submitted = Buffer.from(digest(body.otp)), expected = Buffer.from(record.otp_hash);
                if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
                    await conn.query('UPDATE otp_verifications SET attempts=COALESCE(attempts,0)+1 WHERE id=?', [record.id]);
                    return { invalid: true };
                }
                const [rides] = await conn.query("SELECT r.Ride_ID_Pk FROM ride_history r LEFT JOIN drivers d ON d.id=r.Driver_ID_Fk WHERE (r.User_ID_Fk=? OR d.User_ID_FK=?) AND r.Ride_Status IN ('Requested','Accepted','Arrived','Started','Ongoing') LIMIT 1 FOR UPDATE", [owner.User_ID_Pk,owner.User_ID_Pk]);
                if (rides.length) throw fail(409, 'Complete or cancel your active city ride before signing in to city-to-city driver mode.');
                // This token retains a personal-account identity; city ride access is unchanged.
                const token = signToken({ userId: owner.User_ID_Pk, phone: owner.Mobile, role: 'rider' });
                await conn.query('DELETE FROM otp_verifications WHERE phone_number=? AND purpose=?', [phone,PURPOSE]);
                return { token, user: { id: owner.User_ID_Pk, name: owner.User_Name, phone: owner.Mobile, email: owner.Email, role: 'rider' } };
            });
            if (result.invalid) throw fail(400, 'Invalid or expired code. Request a new code after five attempts.');
            return result;
        },
    };
}
module.exports = { createCityToCityAuth, phoneNumber };
