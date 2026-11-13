const { createHash, timingSafeEqual, randomBytes } = require("node:crypto");
const {
  USER_PHONE_SQL,
  phoneArgs,
  phoneOf,
  acquirePhoneLock,
  releasePhoneLock,
} = require("./appUserIdentity");
const { fail } = require("./employeeAccess");
const { formatDriverCode } = require("../utils/driverHelper");
const MODES = ["rider", "driver", "city_to_city_driver"];
const digest = (v) => createHash("sha256").update(v).digest("hex");
const denied = (u) =>
  Number(u.AccountDeleted) ||
  ["admin", "superadmin", "employee"].includes(
    String(u.Role || "")
      .trim()
      .toLowerCase()
  );
function createMobileAuth({ pool, sendOtp, signToken }) {
  async function transaction(phone, action) {
    const c = await pool.getConnection();
    let lock;
    try {
      if (phone) lock = await acquirePhoneLock(c, phone);
      await c.beginTransaction();
      const r = await action(c);
      await c.commit();
      return r;
    } catch (e) {
      await c.rollback().catch(() => {});
      throw e;
    } finally {
      await releasePhoneLock(c, lock);
      c.release();
    }
  }
  async function byPhone(c, phone) {
    const [rows] = await c.query(
      `SELECT User_ID_Pk,User_Name,Mobile,Email,User_Pic,Role,AccountDeleted,last_active_mode FROM users WHERE ${USER_PHONE_SQL} LIMIT 2 FOR UPDATE`,
      phoneArgs(phone)
    );
    if (rows.length > 1)
      throw fail(409, "Multiple accounts use this phone. Contact support.");
    return rows[0];
  }
  function allowed(u) {
    if (!u) throw fail(404, "No account found. Please sign up first.");
    if (denied(u)) {
      const e = fail(
        403,
        Number(u.AccountDeleted)
          ? "Your account has been deleted. Please appeal to recover your account."
          : "Employee accounts must use the admin panel."
      );
      e.account_deleted = Boolean(Number(u.AccountDeleted));
      throw e;
    }
  }
  async function session(c, u, requestedMode) {
    allowed(u);
    const [drivers] = await c.query(
      "SELECT id,User_ID_FK,full_name,father_name,cnic,phone,email,address,city,dob,vehicle_type,vehicle_model,vehicle_number,vehicle_color,photo_path,Rating,join_date,completed_rides_count,Easypaisa,Easypaisa_Active,JazzCash,JazzCash_Active,status FROM drivers WHERE User_ID_FK=? ORDER BY id LIMIT 2",
      [u.User_ID_Pk]
    );
    if (drivers.length > 1)
      throw fail(
        409,
        "Multiple driver profiles need review. Please contact support."
      );
    const [cityDrivers] = await c.query(
      "SELECT id,driver_code,application_status,full_name,home_city_id FROM city_to_city_drivers WHERE user_id=?",
      [u.User_ID_Pk]
    );
    const mode = MODES.includes(requestedMode)
      ? requestedMode
      : MODES.includes(u.last_active_mode)
      ? u.last_active_mode
      : drivers.length && String(u.Role).toLowerCase() === "driver"
      ? "driver"
      : cityDrivers.length && !drivers.length
      ? "city_to_city_driver"
      : "rider";
    const user = {
      id: u.User_ID_Pk,
      User_ID_Pk: u.User_ID_Pk,
      name: u.User_Name,
      User_Name: u.User_Name,
      phone: phoneOf(u.Mobile) || u.Mobile,
      Mobile: phoneOf(u.Mobile) || u.Mobile,
      email: u.Email,
      Email: u.Email,
      photo: u.User_Pic,
      role: "rider",
      Role: "rider",
    };
    const driver = drivers[0]
      ? {
          ...drivers[0],
          status: String(drivers[0].status || "").trim().toLowerCase(),
          driver_code: formatDriverCode(drivers[0].id),
          role: "driver",
          Role: "driver",
        }
      : null;
    return {
      token: signToken({
        userId: u.User_ID_Pk,
        phone: user.phone,
        role:
          mode === "driver" && driver?.status === "active" ? "driver" : "rider",
      }),
      user,
      profile: mode === "driver" && driver ? driver : user,
      active_mode: mode,
      city_to_city_profile: cityDrivers[0] || null,
      needs_onboarding:
        mode === "driver"
          ? !driver
          : mode === "city_to_city_driver"
          ? !cityDrivers.length
          : false,
      driver_application_only:
        mode === "driver" && !driver,
    };
  }
  return {
    async send(body, register = false) {
      const phone = phoneOf(body?.phone);
      if (!phone)
        throw fail(400, "Enter an 11-digit mobile number beginning with 03.");
      let payload = null;
      if (register) {
        const name =
          typeof body.full_name === "string" ? body.full_name.trim() : "";
        const email = typeof body.email === "string" ? body.email.trim() : "";
        if (
          !name ||
          name.length > 100 ||
          !email ||
          email.length > 100 ||
          !/^\S+@\S+\.\S+$/.test(email)
        )
          throw fail(400, "Enter your name and a valid email address.");
        const mode = body.signup_mode || "rider";
        if (!MODES.includes(mode)) throw fail(400, "Invalid app mode.");
        payload = JSON.stringify({ full_name: name, email, mode });
      }
      return transaction(phone, async (c) => {
        const u = await byPhone(c, phone);
        if (register) {
          if (u)
            throw fail(
              409,
              "This phone already has an account. Please sign in."
            );
          const [emails] = await c.query(
            "SELECT User_ID_Pk FROM users WHERE Email=? LIMIT 1",
            [body.email.trim()]
          );
          if (emails.length)
            throw fail(409, "User already exists with this phone or email");
        } else allowed(u);
        const purpose = register ? "mobile_register" : "mobile_login";
        const [recent] = await c.query(
          "SELECT id FROM otp_verifications WHERE phone_number=? AND purpose IN (?,?) AND created_at>DATE_SUB(NOW(),INTERVAL 60 SECOND) LIMIT 1",
          [phone, "mobile_register", "mobile_login"]
        );
        if (recent.length)
          throw fail(
            429,
            "Please wait one minute before requesting another code."
          );
        const otp = String(await sendOtp(phone));
        if (!/^\d{6}$/.test(otp))
          throw fail(502, "Unable to send verification code.");
        await c.query(
          "DELETE FROM otp_verifications WHERE phone_number=? AND purpose IN (?,?)",
          [phone, "mobile_register", "mobile_login"]
        );
        await c.query(
          "INSERT INTO otp_verifications (phone_number,otp_hash,purpose,payload,expires_at) VALUES (?,?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))",
          [phone, digest(otp), purpose, payload]
        );
        return { message: "Verification code sent.", otp_purpose: purpose };
      });
    },
    async verify(body) {
      const phone = phoneOf(body?.phone_number || body?.phone),
        purpose = body?.otp_purpose;
      if (
        !phone ||
        !["mobile_login", "mobile_register"].includes(purpose) ||
        typeof body.otp !== "string" ||
        !/^\d{6}$/.test(body.otp)
      )
        throw fail(400, "Enter the 6-digit verification code.");
      const result = await transaction(phone, async (c) => {
        const [rows] = await c.query(
          "SELECT id,otp_hash,payload,attempts FROM otp_verifications WHERE phone_number=? AND purpose=? AND verified=0 AND expires_at>NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE",
          [phone, purpose]
        );
        const r = rows[0];
        if (!r || Number(r.attempts) >= 5) return { invalid: true };
        const got = Buffer.from(digest(body.otp)),
          expected = Buffer.from(r.otp_hash);
        if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
          await c.query(
            "UPDATE otp_verifications SET attempts=COALESCE(attempts,0)+1 WHERE id=?",
            [r.id]
          );
          return { invalid: true };
        }
        let u = await byPhone(c, phone),
          mode;
        if (purpose === "mobile_register") {
          if (u)
            throw fail(
              409,
              "This phone already has an account. Please sign in."
            );
          const data = JSON.parse(r.payload);
          mode = data.mode;
          const [email] = await c.query(
            "SELECT User_ID_Pk FROM users WHERE Email=? LIMIT 1",
            [data.email]
          );
          if (email.length)
            throw fail(409, "User already exists with this phone or email");
          const [created] = await c.query(
            "INSERT INTO users (User_Name,Email,Password,Mobile,Role,Unique_ID,last_active_mode) VALUES (?,?,NULL,?,?,?,?)",
            [
              data.full_name,
              data.email,
              phone,
              "rider",
              randomBytes(16).toString("hex"),
              mode,
            ]
          );
          u = {
            User_ID_Pk: created.insertId,
            User_Name: data.full_name,
            Email: data.email,
            Mobile: phone,
            Role: "rider",
            last_active_mode: mode,
          };
        }
        allowed(u);
        const value = await session(c, u, mode);
        await c.query(
          "UPDATE users SET last_active_mode=? WHERE User_ID_Pk=?",
          [value.active_mode, u.User_ID_Pk]
        );
        await c.query("DELETE FROM otp_verifications WHERE id=?", [r.id]);
        return value;
      });
      if (result.invalid)
        throw fail(
          400,
          "Invalid or expired code. Request a new code after five attempts."
        );
      return result;
    },
    async session(userId, mode) {
      return transaction(null, async (c) => {
        const [rows] = await c.query(
          "SELECT User_ID_Pk,User_Name,Mobile,Email,User_Pic,Role,AccountDeleted,last_active_mode FROM users WHERE User_ID_Pk=?",
          [userId]
        );
        return session(c, rows[0], mode);
      });
    },
  };
}
module.exports = { createMobileAuth, MODES };
