const crypto = require("node:crypto");
const { getAccess, fail } = require("./employeeAccess");
const { idOf, validateChanges } = require("./adminDriverProfiles");
const columns = {
  full_name: "User_Name",
  email: "Email",
  cnic: "Cnic",
  address: "Address",
  city: "City",
};
const version = (row) =>
  crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
function createAdminRiderProfiles(pool) {
  async function get(conn, id, lock = false) {
    const [rows] = await conn.query(
      `SELECT User_ID_Pk AS id,User_Name AS full_name,Mobile AS phone,Email AS email,Cnic AS cnic,Address AS address,City AS city FROM users WHERE User_ID_Pk=? AND COALESCE(AccountDeleted,0)=0 AND LOWER(TRIM(COALESCE(Role,''))) IN ('rider','user','customer','')${lock ? " FOR UPDATE" : ""}`,
      [idOf(id)],
    );
    if (!rows.length) throw fail(404, "Active rider not found.");
    return rows[0];
  }
  return {
    async detail(id) {
      const row = await get(pool, id);
      return { ...row, version: version(row) };
    },
    async update(id, actor, body = {}) {
      if (
        !body.changes ||
        Object.keys(body.changes).some((k) => !Object.hasOwn(columns, k))
      )
        throw fail(
          400,
          "Only rider name, email, CNIC, address and city can be edited here.",
        );
      const changes = validateChanges(body.changes);
      if (changes.full_name?.length > 50 || changes.address?.length > 100)
        throw fail(
          400,
          "Name must be at most 50 characters and address at most 100 characters.",
        );
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const access = await getAccess(conn, actor, { lock: true });
        if (!access.functions.includes("riders"))
          throw fail(403, "Rider screen access is required.");
        const row = await get(conn, id, true);
        if (body.version !== version(row))
          throw fail(
            409,
            "The rider profile changed elsewhere. Reopen the latest details.",
          );
        if (changes.email) {
          const [duplicates] = await conn.query(
            "SELECT User_ID_Pk FROM users WHERE Email=? AND User_ID_Pk<>? LIMIT 1",
            [changes.email, idOf(id)],
          );
          if (duplicates.length)
            throw fail(409, "Another account uses this email.");
        }
        await conn.query(
          `UPDATE users SET ${Object.keys(changes)
            .map((k) => `${columns[k]}=?`)
            .join(",")} WHERE User_ID_Pk=?`,
          [...Object.values(changes), idOf(id)],
        );
        const fresh = await get(conn, id);
        await conn.commit();
        return { ...fresh, version: version(fresh) };
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally {
        conn.release();
      }
    },
  };
}
module.exports = { createAdminRiderProfiles };
