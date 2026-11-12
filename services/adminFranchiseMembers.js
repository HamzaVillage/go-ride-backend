const crypto = require("node:crypto");
const { getAccess, fail } = require("./employeeAccess");
const { idOf, validateChanges } = require("./adminDriverProfiles");
const { formatDriverCode } = require("../utils/driverHelper");
async function scope(conn, actor, requested, lock = false) {
  const access = await getAccess(conn, actor, { lock });
  if (!access.functions.includes("franchise_members"))
    throw fail(403, "Franchise member access is required.");
  if (access.is_super_admin) return requested ? idOf(requested) : null;
  const [rows] = await conn.query(
    `SELECT franchise_id FROM employee_franchise_access WHERE employee_id=?${lock ? " FOR UPDATE" : ""}`,
    [actor],
  );
  if (!rows.length)
    throw fail(403, "Ask a super administrator to assign your franchise.");
  const own = Number(rows[0].franchise_id);
  if (requested && idOf(requested) !== own)
    throw fail(403, "You can only manage your assigned franchise.");
  return own;
}
function validateMember(body = {}) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (k) =>
        !["franchise_id", "kind", "idempotency_key", "profile"].includes(k),
    )
  )
    throw fail(400, "Invalid member request.");
  if (!["driver", "rider"].includes(body.kind))
    throw fail(400, "Choose driver or rider.");
  if (
    typeof body.idempotency_key !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(body.idempotency_key)
  )
    throw fail(400, "A request key is required.");
  const allowed = [
    "full_name",
    "phone",
    "email",
    "city",
    "address",
    ...(body.kind === "driver"
      ? [
          "father_name",
          "cnic",
          "dob",
          "vehicle_type",
          "vehicle_model",
          "vehicle_number",
          "vehicle_color",
        ]
      : []),
  ];
  if (
    !body.profile ||
    Object.keys(body.profile).some((k) => !allowed.includes(k))
  )
    throw fail(400, "Invalid member profile.");
  const data = validateChanges(body.profile);
  if (data.full_name?.length > 50 || data.address?.length > 100)
    throw fail(
      400,
      "Name must be at most 50 characters and address at most 100 characters.",
    );
  for (const key of [
    "full_name",
    "phone",
    "city",
    ...(body.kind === "driver"
      ? ["cnic", "vehicle_type", "vehicle_number"]
      : []),
  ])
    if (!data[key]) throw fail(400, `Enter ${key.replaceAll("_", " ")}.`);
  const local = data.phone.replace(/^\+92/, "0").replace(/^92(?=3\d{9}$)/, "0");
  if (!/^03\d{9}$/.test(local))
    throw fail(400, "Enter a valid Pakistani mobile number.");
  data.phone = local;
  return data;
}
function createAdminFranchiseMembers(pool) {
  return {
    async list(actor, query = {}) {
      const conn = await pool.getConnection();
      try {
        const franchiseId = await scope(conn, actor, query.franchise_id);
        const currentAccess = await getAccess(conn, actor);
        const [franchises] = await conn.query(
          `SELECT id,company_name,city,status FROM franchiser ${franchiseId && !currentAccess.is_super_admin ? "WHERE id=?" : ""} ORDER BY company_name`,
          franchiseId && !currentAccess.is_super_admin ? [franchiseId] : [],
        );
        if (!franchiseId)
          return {
            franchises,
            franchise_id: null,
            drivers: [],
            riders: [],
            page: 1,
            has_more: false,
          };
        const page = Number(query.page || 1);
        if (!Number.isInteger(page) || page < 1 || page > 100000)
          throw fail(400, "Invalid page.");
        const [drivers] = await conn.query(
          "SELECT id,full_name AS name,phone,city,vehicle_type,vehicle_number,status FROM drivers WHERE Franchiser_ID_FK=? ORDER BY id DESC LIMIT 21 OFFSET ?",
          [franchiseId, (page - 1) * 20],
        );
        const [riders] = await conn.query(
          "SELECT User_ID_Pk AS id,User_Name AS name,Mobile AS phone,Email AS email,City AS city,Address AS address FROM users WHERE Franchiser_ID_FK=? AND COALESCE(AccountDeleted,0)=0 AND LOWER(TRIM(COALESCE(Role,''))) IN ('rider','user','customer','') ORDER BY User_ID_Pk DESC LIMIT 21 OFFSET ?",
          [franchiseId, (page - 1) * 20],
        );
        return {
          franchises,
          franchise_id: franchiseId,
          drivers: drivers.slice(0, 20),
          riders: riders.slice(0, 20),
          page,
          has_more: drivers.length > 20 || riders.length > 20,
        };
      } finally {
        conn.release();
      }
    },
    async create(actor, body) {
      const data = validateMember(body),
        conn = await pool.getConnection();
      let started = false,
        locked = false;
      const fingerprint = crypto
        .createHash("sha256")
        .update(JSON.stringify([body.kind, body.franchise_id, data]))
        .digest("hex");
      const lockName = `franchise-member:${data.phone}`;
      try {
        const [locks] = await conn.query("SELECT GET_LOCK(?,10) AS acquired", [
          lockName,
        ]);
        if (Number(locks[0]?.acquired) !== 1)
          throw fail(409, "This phone is being registered. Try again.");
        locked = true;
        await conn.beginTransaction();
        started = true;
        const franchiseId = await scope(conn, actor, body.franchise_id, true);
        if (!franchiseId) throw fail(400, "Choose a franchise.");
        const [franchises] = await conn.query(
          "SELECT id,status FROM franchiser WHERE id=? FOR UPDATE",
          [franchiseId],
        );
        if (franchises[0]?.status !== "active")
          throw fail(409, "Only an active franchise can add members.");
        const [retries] = await conn.query(
          "SELECT * FROM admin_franchise_member_requests WHERE request_key=? FOR UPDATE",
          [body.idempotency_key],
        );
        if (retries.length) {
          const old = retries[0];
          if (
            Number(old.actor_id) !== Number(actor) ||
            Number(old.franchise_id) !== franchiseId ||
            old.fingerprint !== fingerprint
          )
            throw fail(409, "This request key was already used.");
          await conn.commit();
          started = false;
          return { id: old.member_id, kind: old.member_kind, replayed: true };
        }
        const [users] = await conn.query(
          "SELECT User_ID_Pk FROM users WHERE REPLACE(REPLACE(REPLACE(Mobile,'-',''),' ',''),'+92','0') IN (?,?) OR (? IS NOT NULL AND Email=?) LIMIT 1",
          [
            data.phone,
            "92" + data.phone.slice(1),
            data.email || null,
            data.email || null,
          ],
        );
        const [drivers] = await conn.query(
          "SELECT id FROM drivers WHERE REPLACE(REPLACE(REPLACE(phone,'-',''),' ',''),'+92','0') IN (?,?) LIMIT 1",
          [data.phone, "92" + data.phone.slice(1)],
        );
        if (users.length || drivers.length)
          throw fail(
            409,
            "This phone or email already belongs to an account. Existing accounts cannot be reassigned here.",
          );
        const [u] = await conn.query(
          "INSERT INTO users (User_Name,Mobile,Email,Role,Unique_ID,Franchiser_ID_FK,City,Address,Cnic) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            data.full_name,
            data.phone,
            data.email || null,
            body.kind,
            crypto.randomBytes(16).toString("hex"),
            franchiseId,
            data.city,
            data.address || null,
            data.cnic || null,
          ],
        );
        let memberId = u.insertId;
        if (body.kind === "driver") {
          const fields = Object.keys(data);
          const [d] = await conn.query(
            `INSERT INTO drivers (User_ID_FK,Franchiser_ID_FK,status,join_date,${fields.join(",")}) VALUES (?,?,'pending',CURDATE(),${fields.map(() => "?").join(",")})`,
            [u.insertId, franchiseId, ...Object.values(data)],
          );
          memberId = d.insertId;
          await conn.query("UPDATE drivers SET driver_code=? WHERE id=?", [
            formatDriverCode(memberId),
            memberId,
          ]);
        }
        await conn.query(
          "INSERT INTO admin_franchise_member_requests (request_key,actor_id,franchise_id,fingerprint,member_kind,member_id) VALUES (?,?,?,?,?,?)",
          [
            body.idempotency_key,
            actor,
            franchiseId,
            fingerprint,
            body.kind,
            memberId,
          ],
        );
        await conn.commit();
        started = false;
        return {
          id: memberId,
          kind: body.kind,
          status: body.kind === "driver" ? "pending" : "active",
        };
      } catch (error) {
        if (started) await conn.rollback().catch(() => {});
        throw error;
      } finally {
        if (locked)
          await conn
            .query("SELECT RELEASE_LOCK(?)", [lockName])
            .catch(() => {});
        conn.release();
      }
    },
    async assign(actor, body = {}) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const access = await getAccess(conn, actor, { lock: true });
        if (!access.is_super_admin)
          throw fail(
            403,
            "Only a super administrator can assign franchise staff.",
          );
        const employee = idOf(body.employee_id),
          franchise =
            body.franchise_id == null ? null : idOf(body.franchise_id);
        const [rows] = await conn.query(
          "SELECT emp_id FROM employee WHERE emp_id=? AND account_type='employee' AND is_active=1 AND is_deleted=0 FOR UPDATE",
          [employee],
        );
        if (!rows.length) throw fail(400, "Choose an active employee account.");
        if (franchise) {
          const [f] = await conn.query("SELECT id FROM franchiser WHERE id=?", [
            franchise,
          ]);
          if (!f.length) throw fail(404, "Franchise not found.");
          await conn.query(
            "INSERT INTO employee_franchise_access (employee_id,franchise_id,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE franchise_id=VALUES(franchise_id),updated_by=VALUES(updated_by)",
            [employee, franchise, actor],
          );
        } else
          await conn.query(
            "DELETE FROM employee_franchise_access WHERE employee_id=?",
            [employee],
          );
        await conn.commit();
        return { employee_id: employee, franchise_id: franchise };
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally {
        conn.release();
      }
    },
  };
}
module.exports = { createAdminFranchiseMembers, validateMember, scope };
