const crypto = require("node:crypto"),
  bcrypt = require("bcryptjs");
const { fail } = require("./employeeAccess");
const { formatDriverCode } = require("../utils/driverHelper");
const {
  USER_PHONE_SQL,
  phoneArgs,
  phoneOf,
  acquirePhoneLock,
  releasePhoneLock,
} = require("./appUserIdentity");
const DOCS = {
  Photo: ["photo", "photo_path"],
  CNIC_Front: ["cnic_front", "cnic_front_path"],
  CNIC_Back: ["cnic_back", "cnic_back_path"],
  License: ["license", "license_path"],
  Vehicle_Running_Page: ["vehicle_registration", "vehicle_doc_path"],
};
const clean = (v) =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, "");
const sameVehicle = (body, vehicle) =>
  Boolean(vehicle) &&
  clean(body.Vehicle_Number) === clean(vehicle.registration_number) &&
  clean(body.Vehicle_Model) === clean(vehicle.model) &&
  !/(bike|motorcycle|rick|rik|auto|loader)/i.test(body.Vehicle_Type || "");
function validate(body) {
  const out = {};
  for (const [key, max] of Object.entries({
    Name: 100,
    Cnic: 15,
    DOB: 10,
    Address: 1000,
    City: 50,
    Vehicle_Type: 20,
    Vehicle_Model: 50,
    Vehicle_Number: 20,
    Vehicle_Color: 30,
  })) {
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    if (!value || value.length > max)
      throw fail(400, `Enter a valid ${key.replaceAll("_", " ")}.`);
    out[key] = value;
  }
  if (!/^\d{13}$/.test(out.Cnic.replace(/-/g, "")))
    throw fail(400, "Enter a valid 13-digit CNIC.");
  let dob = out.DOB;
  const parts = dob.split(/[\/-]/);
  if (parts.length === 3 && parts[0].length !== 4)
    dob = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(
      2,
      "0"
    )}`;
  const date = new Date(`${dob}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dob) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dob ||
    date >= new Date()
  )
    throw fail(400, "Enter a valid date of birth.");
  out.DOB = dob;
  for (const [key, max] of Object.entries({
    FatherName: 100,
    Email: 100,
    EasyPaisa: 20,
    JazzCash: 20,
  })) {
    if (
      body[key] != null &&
      (typeof body[key] !== "string" || body[key].length > max)
    )
      throw fail(400, `Invalid ${key}.`);
    out[key] = body[key]?.trim() || null;
  }
  return out;
}
function createNormalDriverEnrollment(pool) {
  async function transaction(phone, fn) {
    const conn = await pool.getConnection();
    let lock;
    try {
      lock = await acquirePhoneLock(conn, phone);
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      await releasePhoneLock(conn, lock);
      conn.release();
    }
  }
  async function owner(conn, userId, lock = false) {
    const [rows] = await conn.query(
      `SELECT User_ID_Pk,User_Name,Mobile,Email,Password,Role,AccountDeleted,Cnic,Address,City FROM users WHERE User_ID_Pk=?${
        lock ? " FOR UPDATE" : ""
      }`,
      [userId]
    );
    const u = rows[0];
    if (
      !u ||
      Number(u.AccountDeleted) ||
      ["admin", "superadmin", "employee"].includes(
        String(u.Role).trim().toLowerCase()
      )
    )
      throw fail(403, "An active personal account is required.");
    return u;
  }
  async function source(conn, userId) {
    const [rows] = await conn.query(
      "SELECT d.id,d.full_name,d.father_name,d.cnic,DATE_FORMAT(d.dob,'%Y-%m-%d') AS dob,d.address,d.easypaisa,d.jazzcash,c.City_Name AS city FROM city_to_city_drivers d LEFT JOIN city c ON c.ID_PK=d.home_city_id WHERE d.user_id=?",
      [userId]
    );
    if (!rows[0]) return { profile: null, vehicle: null, documents: {} };
    const profile = rows[0];
    const [vehicles] = await conn.query(
      "SELECT id,vehicle_type,model,registration_number,color FROM city_to_city_vehicles WHERE city_to_city_driver_id=? AND is_active=1 ORDER BY id DESC LIMIT 1",
      [profile.id]
    );
    const [docs] = await conn.query(
      "SELECT document_type,vehicle_id,file_key FROM city_to_city_driver_documents WHERE city_to_city_driver_id=? AND review_status<>'rejected' AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP()) ORDER BY id DESC",
      [profile.id]
    );
    const documents = {};
    for (const [field, [type]] of Object.entries(DOCS)) {
      const doc = docs.find(
        (d) =>
          d.document_type === type &&
          (type !== "vehicle_registration" ||
            Number(d.vehicle_id) === Number(vehicles[0]?.id))
      );
      if (doc) documents[field] = doc.file_key;
    }
    return { profile, vehicle: vehicles[0] || null, documents };
  }
  async function insert(
    conn,
    user,
    data,
    files,
    existingSource = null,
    requireDocs = false
  ) {
    const phone = phoneOf(user.Mobile);
    if (!phone) throw fail(400, "Your account needs a valid mobile number.");
    const [existing] = await conn.query(
      "SELECT id,User_ID_FK,status FROM drivers WHERE User_ID_FK=? OR REPLACE(REPLACE(REPLACE(phone,'-',''),' ',''),'+','') IN (?,?) LIMIT 2 FOR UPDATE",
      [user.User_ID_Pk, ...phoneArgs(phone)]
    );
    if (existing.length) {
      if (
        existing.length === 1 &&
        Number(existing[0].User_ID_FK) === Number(user.User_ID_Pk)
      )
        return {
          id: existing[0].id,
          driver_code: formatDriverCode(existing[0].id),
          status: existing[0].status,
          already_submitted: true,
          user_id: user.User_ID_Pk,
        };
      throw fail(
        409,
        "A driver account already uses this phone. Contact support."
      );
    }
    const [types] = await conn.query(
      "SELECT Vehicle_Type FROM vehicle_fare_rate WHERE LOWER(TRIM(Vehicle_Type))=LOWER(TRIM(?)) AND Is_Active=1 LIMIT 1",
      [data.Vehicle_Type]
    );
    if (!types.length) throw fail(400, "Choose an active vehicle type.");
    const paths = {};
    for (const [field, [, column]] of Object.entries(DOCS)) {
      let reused = existingSource?.documents[field];
      if (
        ["CNIC_Front", "CNIC_Back"].includes(field) &&
        clean(data.Cnic) !== clean(existingSource?.profile?.cnic)
      )
        reused = null;
      if (
        field === "Vehicle_Running_Page" &&
        !sameVehicle(data, existingSource?.vehicle)
      )
        reused = null;
      paths[column] = files[field] || reused || null;
      if (requireDocs && !paths[column])
        throw fail(
          400,
          `Upload ${field.replaceAll("_", " ")} before submitting.`
        );
    }
    const fields = {
      User_ID_FK: user.User_ID_Pk,
      full_name: data.Name,
      father_name: data.FatherName,
      cnic: data.Cnic,
      Easypaisa: data.EasyPaisa,
      JazzCash: data.JazzCash,
      dob: data.DOB,
      phone,
      email: data.Email || user.Email || null,
      address: data.Address,
      city: data.City,
      vehicle_type: types[0].Vehicle_Type,
      vehicle_model: data.Vehicle_Model,
      vehicle_number: data.Vehicle_Number,
      vehicle_color: data.Vehicle_Color,
      ...paths,
      password: user.Password || null,
    };
    const [r] = await conn.query(
      `INSERT INTO drivers (${Object.keys(fields).join(
        ","
      )},status,join_date) VALUES (${Object.keys(fields)
        .map(() => "?")
        .join(",")},'pending',CURDATE())`,
      Object.values(fields)
    );
    await conn.query("UPDATE drivers SET driver_code=? WHERE id=?", [
      formatDriverCode(r.insertId),
      r.insertId,
    ]);
    return {
      id: r.insertId,
      user_id: user.User_ID_Pk,
      driver_code: formatDriverCode(r.insertId),
      status: "pending",
      reused_documents: Object.keys(DOCS).filter(
        (f) => !files[f] && paths[DOCS[f][1]]
      ),
    };
  }
  return {
    async options(userId) {
      const c = await pool.getConnection();
      try {
        const u = await owner(c, userId),
          s = await source(c, userId);
        return {
          has_city_to_city_profile: Boolean(s.profile),
          prefill: {
            Name: s.profile?.full_name || u.User_Name,
            FatherName: s.profile?.father_name || "",
            Cnic: s.profile?.cnic || u.Cnic || "",
            DOB: s.profile?.dob || "",
            Address: s.profile?.address || u.Address || "",
            City: s.profile?.city || u.City || "",
            Mobile: phoneOf(u.Mobile) || u.Mobile,
            Email: u.Email || "",
            EasyPaisa: s.profile?.easypaisa || "",
            JazzCash: s.profile?.jazzcash || "",
          },
          reusable_documents: Object.keys(s.documents).filter(
            (f) => f !== "Vehicle_Running_Page"
          ),
          vehicle: s.vehicle
            ? {
                ...s.vehicle,
                registration_document_available: Boolean(
                  s.documents.Vehicle_Running_Page
                ),
              }
            : null,
        };
      } finally {
        c.release();
      }
    },
    async enroll(userId, body, files = {}) {
      const data = validate(body),
        c = await pool.getConnection();
      let u;
      try {
        u = await owner(c, userId);
      } finally {
        c.release();
      }
      const phone = phoneOf(u.Mobile);
      if (!phone) throw fail(400, "Your account needs a valid mobile number.");
      if (body.Mobile && phoneOf(body.Mobile) !== phone)
        throw fail(400, "Use your signed-in account mobile number.");
      return transaction(phone, async (conn) => {
        const user = await owner(conn, userId, true);
        const s = await source(conn, userId);
        return insert(conn, user, data, files, s, Boolean(s.profile));
      });
    },
    async registerPublic(body, files = {}) {
      const data = validate(body),
        phone = phoneOf(body.Mobile);
      if (!phone) throw fail(400, "Enter a valid mobile number.");
      const hash = body.Password ? await bcrypt.hash(String(body.Password), 10) : null;
      return transaction(phone, async (conn) => {
        const [existing] = await conn.query(
          `SELECT User_ID_Pk FROM users WHERE ${USER_PHONE_SQL} LIMIT 2 FOR UPDATE`,
          phoneArgs(phone)
        );
        if (existing.length)
          throw fail(
            409,
            "Sign in to your existing account to become a driver."
          );
        const [created] = await conn.query(
          "INSERT INTO users (User_Name,Email,Password,Mobile,Role,Unique_ID,User_Pic) VALUES (?,?,?,?,?,?,?)",
          [
            data.Name,
            data.Email,
            hash,
            phone,
            "driver",
            crypto.randomBytes(16).toString("hex"),
            files.Photo || null,
          ]
        );
        return insert(
          conn,
          {
            User_ID_Pk: created.insertId,
            Mobile: phone,
            Email: data.Email,
            Password: hash,
          },
          data,
          files
        );
      });
    },
  };
}
module.exports = { createNormalDriverEnrollment, sameVehicle, validate, DOCS };
