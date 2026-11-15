const bcrypt = require("bcryptjs");
const {
  fail,
  getAccess,
  screenKey,
  requirePermission,
  ACTIONS,
} = require("./employeeAccess");
const idOf = (value) => {
  if (
    !["string", "number"].includes(typeof value) ||
    !/^[1-9]\d*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw fail(400, "Invalid record ID.");
  return Number(value);
};
function text(value, label, max, required = false) {
  if (value == null && !required) return null;
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw fail(400, `Enter a valid ${label} (up to ${max} characters).`);
  return value.trim() || null;
}
function flag(value) {
  if (typeof value !== "boolean")
    throw fail(400, "Active/deleted status must be true or false.");
  return value ? 1 : 0;
}
function ids(value) {
  if (!Array.isArray(value) || value.length > 500)
    throw fail(400, "Choose at most 500 assignments.");
  const result = value.map(idOf);
  if (new Set(result).size !== result.length)
    throw fail(400, "Assignments must be unique.");
  return result.sort((a, b) => a - b);
}
function validateEmployee(body, creating = false) {
  if (!body || Array.isArray(body) || typeof body !== "object")
    throw fail(400, "Invalid employee details.");
  const allowed = [
    "name",
    "email",
    "phone",
    "cnic",
    "father_name",
    "father_cnic",
    "address",
    "password",
    "is_active",
    "is_deleted",
    "role_ids",
    "version",
    "account_type",
    "franchise_id",
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw fail(400, "Unknown employee field.");
  const data = {};
  if (creating || Object.hasOwn(body, "account_type")) {
    data.account_type = body.account_type || "employee";
    if (!["employee", "superadmin"].includes(data.account_type))
      throw fail(400, "Choose employee or super administrator.");
  }
  for (const [key, max, required] of [
    ["name", 50, true],
    ["email", 100, true],
    ["phone", 30, true],
    ["address", 1000, false],
    ["father_name", 100, false],
  ]) {
    if (creating || Object.hasOwn(body, key))
      data[key] = text(body[key], key.replaceAll("_", " "), max, required);
  }
  if (data.email) {
    data.email = data.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
      throw fail(400, "Enter a valid email.");
  }
  if (data.phone && !/^\+?[\d -]{7,30}$/.test(data.phone))
    throw fail(400, "Enter a valid phone number.");
  for (const key of ["cnic", "father_cnic"])
    if (creating || Object.hasOwn(body, key)) {
      const value = text(body[key], key, 15);
      if (value && !/^\d{5}-?\d{7}-?\d$/.test(value))
        throw fail(400, "CNIC must contain 13 digits.");
      data[key] = value?.replaceAll("-", "") || null;
    }
  if (creating || Object.hasOwn(body, "password")) {
    if (
      typeof body.password !== "string" ||
      body.password.length < 12 ||
      Buffer.byteLength(body.password) > 72
    )
      throw fail(
        400,
        "Password must be at least 12 characters and at most 72 UTF-8 bytes.",
      );
  }
  for (const key of ["is_active", "is_deleted"])
    if (Object.hasOwn(body, key)) data[key] = flag(body[key]);
  if (body.role_ids !== undefined) ids(body.role_ids);
  if (body.franchise_id != null) idOf(body.franchise_id);
  return data;
}
function validatePermissions(value) {
  if (!Array.isArray(value) || value.length > 500)
    throw fail(400, "Choose at most 500 screen permissions.");
  const seen = new Set();
  return value.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some((k) => !["function_id", ...ACTIONS].includes(k))
    )
      throw fail(400, "Invalid screen permissions.");
    const function_id = idOf(row.function_id);
    if (seen.has(function_id))
      throw fail(400, "Screen permissions must be unique.");
    seen.add(function_id);
    for (const a of ACTIONS)
      if (typeof row[a] !== "boolean")
        throw fail(400, "Permission values must be true or false.");
    if (!row.can_view && ACTIONS.slice(1).some((a) => row[a]))
      throw fail(400, "Enable View before granting Add, Edit or Delete.");
    return {
      function_id,
      ...Object.fromEntries(ACTIONS.map((a) => [a, row[a]])),
    };
  });
}
const DOC_KEYS = ["cnic_front", "cnic_back", "other_document"];
const employeeColumns = `emp_id, account_type, name, email, phone, cnic, father_name, father_cnic, address,
    cnic_front IS NOT NULL AS has_cnic_front, cnic_back IS NOT NULL AS has_cnic_back, other_document IS NOT NULL AS has_other_document,
    is_active, is_deleted, version, created_at, created_by, updated_at, updated_by,
    (SELECT franchise_id FROM employee_franchise_access WHERE employee_id=employee.emp_id) AS franchise_id`;
function normalize(row) {
  return {
    ...row,
    is_active: Boolean(row.is_active),
    is_deleted: Boolean(row.is_deleted),
  };
}
function createEmployeeService(pool) {
  async function read(action) {
    let conn;
    try {
      conn = await pool.getConnection();
      return await action(conn);
    } finally {
      conn?.release();
    }
  }
  async function mutate(
    actor,
    action,
    permission = "can_edit",
    rootOnly = false,
  ) {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const access = await getAccess(conn, idOf(actor), { lock: true });
      requirePermission(access, "employees", permission);
      if (rootOnly && !access.is_super_admin)
        throw fail(
          403,
          "Only a super administrator can assign role permissions.",
        );
      const result = await action(conn, access);
      await conn.commit();
      return result;
    } catch (error) {
      if (conn) await conn.rollback().catch(() => {});
      if (error.code === "ER_DUP_ENTRY")
        throw fail(
          409,
          "This email, CNIC, role name, or function code is already in use.",
        );
      if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code))
        throw fail(
          409,
          "Another administrator is updating these permissions. Refresh and try again.",
        );
      throw error;
    } finally {
      conn?.release();
    }
  }
  async function locked(conn, table, key, id, version) {
    const [rows] = await conn.query(
      `SELECT * FROM ${table} WHERE ${key} = ? AND is_deleted = 0 FOR UPDATE`,
      [idOf(id)],
    );
    if (!rows.length) throw fail(404, "Record not found.");
    if (!Number.isSafeInteger(version) || rows[0].version !== version)
      throw fail(409, "This record changed. Refresh it before saving.");
    return rows[0];
  }
  async function replaceAssignments(
    conn,
    table,
    parentKey,
    parentId,
    childKey,
    values,
    actor,
  ) {
    const selected = ids(values);
    const childTable =
      childKey === "role_id" ? "employee_role" : "employee_function";
    if (selected.length) {
      const [rows] = await conn.query(
        `SELECT ${childKey} FROM ${childTable} WHERE ${childKey} IN (${selected.map(() => "?").join(",")}) AND is_deleted = 0 LOCK IN SHARE MODE`,
        selected,
      );
      if (rows.length !== selected.length)
        throw fail(400, "One or more selected roles/screens no longer exist.");
    }
    await conn.query(
      `UPDATE ${table} SET is_active = 0, is_deleted = 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE ${parentKey} = ? AND is_deleted = 0`,
      [actor, parentId],
    );
    for (const childId of selected)
      await conn.query(
        `INSERT INTO ${table} (${parentKey}, ${childKey}, created_by, updated_by) VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE is_active = 1, is_deleted = 0, updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
        [parentId, childId, actor, actor],
      );
  }
  async function replaceRolePermissions(conn, roleId, grants, actor) {
    const selected = grants.filter((p) => ACTIONS.some((a) => p[a]));
    if (selected.length) {
      const [rows] = await conn.query(
        `SELECT function_id FROM employee_function WHERE function_id IN (${selected.map(() => "?").join(",")}) AND is_deleted=0 LOCK IN SHARE MODE`,
        selected.map((p) => p.function_id),
      );
      if (rows.length !== selected.length)
        throw fail(400, "One or more selected screens are unavailable.");
    }
    await conn.query(
      "UPDATE assign_role_function SET is_active=0,is_deleted=1,can_view=0,can_add=0,can_edit=0,can_delete=0,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE role_id=?",
      [actor, roleId],
    );
    for (const p of selected)
      await conn.query(
        `INSERT INTO assign_role_function (role_id,function_id,can_view,can_add,can_edit,can_delete,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE can_view=VALUES(can_view),can_add=VALUES(can_add),can_edit=VALUES(can_edit),can_delete=VALUES(can_delete),is_active=1,is_deleted=0,updated_by=VALUES(updated_by),updated_at=CURRENT_TIMESTAMP`,
        [
          roleId,
          p.function_id,
          ...ACTIONS.map((a) => (p[a] ? 1 : 0)),
          actor,
          actor,
        ],
      );
  }
  async function detail(conn, id) {
    const [rows] = await conn.query(
      `SELECT ${employeeColumns} FROM employee WHERE emp_id = ? AND is_deleted = 0`,
      [idOf(id)],
    );
    if (!rows.length) throw fail(404, "Employee not found.");
    const [roles] = await conn.query(
      "SELECT a.role_id FROM assign_role a JOIN employee_role r ON r.role_id = a.role_id AND r.is_deleted = 0 WHERE a.emp_id = ? AND a.is_active = 1 AND a.is_deleted = 0",
      [id],
    );
    return {
      ...normalize(rows[0]),
      role_ids: roles.map((role) => Number(role.role_id)),
    };
  }
  return {
    async list(query = {}) {
      const page = query.page === undefined ? 1 : idOf(query.page);
      const limit = query.limit === undefined ? 20 : idOf(query.limit);
      if (page > 100000 || limit > 100) throw fail(400, "Invalid page size.");
      const q = text(query.q, "search", 100) || "";
      const status = query.status || "all";
      if (!["all", "active", "inactive"].includes(status))
        throw fail(400, "Invalid employee status.");
      const where = ["e.is_deleted = 0"];
      const args = [];
      if (q) {
        where.push(
          "(e.name LIKE ? ESCAPE '=' OR e.email LIKE ? ESCAPE '=' OR e.phone LIKE ? ESCAPE '=')",
        );
        args.push(...Array(3).fill(`%${q.replace(/[=%_]/g, (c) => `=${c}`)}%`));
      }
      if (status !== "all") {
        where.push("e.is_active = ?");
        args.push(status === "active" ? 1 : 0);
      }
      return read(async (conn) => {
        const [counts] = await conn.query(
          `SELECT COUNT(*) AS total FROM employee e WHERE ${where.join(" AND ")}`,
          args,
        );
        // The directory omits CNIC, family details, address, credentials and document paths.
        const [rows] = await conn.query(
          `SELECT e.emp_id, e.account_type, e.name, e.email, e.phone, e.is_active, e.version, e.created_at,
                    (SELECT GROUP_CONCAT(r.role_name ORDER BY r.role_name SEPARATOR ', ') FROM assign_role a JOIN employee_role r ON r.role_id = a.role_id
                    WHERE a.emp_id = e.emp_id AND a.is_active = 1 AND a.is_deleted = 0 AND r.is_deleted = 0) AS roles
                    FROM employee e WHERE ${where.join(" AND ")} ORDER BY e.emp_id DESC LIMIT ? OFFSET ?`,
          [...args, limit, (page - 1) * limit],
        );
        const total = Number(counts[0].total);
        return {
          employees: rows.map(normalize),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };
      });
    },
    detail(id) {
      return read((conn) => detail(conn, id));
    },
    async saveEmployee(id, actor, body) {
      const data = validateEmployee(body, !id);
      const hash =
        body.password !== undefined
          ? await bcrypt.hash(body.password, 12)
          : null;
      return mutate(
        actor,
        async (conn, access) => {
          if (
            body.is_deleted === true &&
            Object.keys(body).some(
              (key) => !["is_deleted", "version", "id"].includes(key),
            )
          )
            requirePermission(access, "employees", "can_edit");
          if (
            !access.is_super_admin &&
            (body.franchise_id !== undefined || body.role_ids !== undefined || body.account_type === "superadmin")
          )
            throw fail(
              403,
              "Only a super administrator can assign roles or administrator access.",
            );
          let employeeId;
          if (id) {
            const row = await locked(
              conn,
              "employee",
              "emp_id",
              id,
              body.version,
            );
            if (
              !access.is_super_admin &&
              (row.account_type === "superadmin" ||
                data.account_type === "superadmin")
            )
              throw fail(
                403,
                "Only a super administrator can manage super administrators.",
              );
            if (
              Number(row.emp_id) === Number(actor) &&
              (body.is_active === false ||
                body.is_deleted === true ||
                body.role_ids !== undefined ||
                body.franchise_id !== undefined ||
                (data.account_type && data.account_type !== row.account_type))
            )
              throw fail(
                400,
                "Ask another super administrator to change your own status, account type or role assignments.",
              );
            employeeId = Number(row.emp_id);
          } else if (
            data.account_type === "superadmin" &&
            !access.is_super_admin
          )
            throw fail(
              403,
              "Only a super administrator can create super administrators.",
            );
          if (body.franchise_id != null) {
            if (data.account_type === 'superadmin') throw fail(400,'Super administrators have global access; choose an employee account for franchise access.');
            const [franchises] = await conn.query("SELECT id FROM franchiser WHERE id=? AND status='active' LOCK IN SHARE MODE", [idOf(body.franchise_id)]);
            if (!franchises.length) throw fail(400,'Choose an active franchise.');
          }
          if (data.email) {
            const [existing] = await conn.query(
              "SELECT emp_id FROM employee WHERE LOWER(TRIM(email)) = ? AND emp_id <> ? LIMIT 1",
              [data.email, employeeId || 0],
            );
            if (existing.length)
              throw fail(
                409,
                "This email is already linked to an employee account.",
              );
          }
          if (hash) data.password_hash = hash;
          const fields = Object.keys(data);
          if (!id) {
            const [employee] = await conn.query(
              `INSERT INTO employee (${fields.join(",")}, created_by, updated_by) VALUES (${fields.map(() => "?").join(",")}, ?, ?)`,
              [...Object.values(data), actor, actor],
            );
            employeeId = employee.insertId;
          } else {
            await conn.query(
              `UPDATE employee SET ${fields.map((key) => `${key} = ?, `).join("")} version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE emp_id = ?`,
              [...Object.values(data), actor, employeeId],
            );
          }
          if (body.role_ids !== undefined)
            await replaceAssignments(
              conn,
              "assign_role",
              "emp_id",
              employeeId,
              "role_id",
              body.role_ids,
              actor,
            );
          if (body.franchise_id !== undefined) {
            if (body.franchise_id == null) await conn.query('DELETE FROM employee_franchise_access WHERE employee_id=?',[employeeId]);
            else await conn.query('INSERT INTO employee_franchise_access (employee_id,franchise_id,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE franchise_id=VALUES(franchise_id),updated_by=VALUES(updated_by)',[employeeId,idOf(body.franchise_id),actor]);
          }
          if (data.is_deleted) return { emp_id: employeeId, is_deleted: true };
          return detail(conn, employeeId);
        },
        !id ? "can_add" : body.is_deleted ? "can_delete" : "can_edit",
      );
    },
    async franchiseOptions(actor) {
      return read(async conn=>{
        const access=await getAccess(conn,actor);
        if (!access.is_super_admin) throw fail(403,'Only a super administrator can assign franchises.');
        const [franchises]=await conn.query('SELECT id,company_name,city,status FROM franchiser ORDER BY company_name');
        return {franchises};
      });
    },
    async catalog() {
      return read(async (conn) => {
        const [roles] = await conn.query(
          "SELECT * FROM employee_role WHERE is_deleted = 0 ORDER BY role_name",
        );
        const [assignments] = await conn.query(
          "SELECT role_id, function_id, can_view, can_add, can_edit, can_delete FROM assign_role_function WHERE is_active = 1 AND is_deleted = 0",
        );
        const [functions] = await conn.query(
          "SELECT * FROM employee_function WHERE is_deleted = 0 ORDER BY function_id",
        );
        const grants = new Map();
        for (const assignment of assignments) {
          const key = Number(assignment.role_id);
          if (!grants.has(key)) grants.set(key, []);
          grants.get(key).push({
            function_id: Number(assignment.function_id),
            ...Object.fromEntries(
              ACTIONS.map((a) => [a, Number(assignment[a]) === 1]),
            ),
          });
        }
        return {
          roles: roles.map((role) => ({
            ...normalize(role),
            permissions: grants.get(Number(role.role_id)) || [],
            function_ids: (grants.get(Number(role.role_id)) || [])
              .filter((p) => p.can_view)
              .map((p) => p.function_id),
          })),
          functions: functions.map(normalize),
        };
      });
    },
    async saveRole(id, actor, body) {
      if (
        !body ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (key) =>
            ![
              "role_name",
              "role_description",
              "is_active",
              "is_deleted",
              "function_ids",
              "permissions",
              "version",
            ].includes(key),
        )
      )
        throw fail(400, "Invalid role details.");
      const data = {};
      if (!id || body.role_name !== undefined)
        data.role_name = text(body.role_name, "role name", 100, true);
      if (!id || body.role_description !== undefined)
        data.role_description = text(
          body.role_description,
          "role description",
          1000,
        );
      for (const key of ["is_active", "is_deleted"])
        if (body[key] !== undefined) data[key] = flag(body[key]);
      if (body.function_ids !== undefined) ids(body.function_ids);
      const grants =
        body.permissions === undefined
          ? body.function_ids === undefined
            ? undefined
            : ids(body.function_ids).map((function_id) => ({
                function_id,
                can_view: true,
                can_add: false,
                can_edit: false,
                can_delete: false,
              }))
          : validatePermissions(body.permissions);
      return mutate(
        actor,
        async (conn) => {
          let roleId = id && idOf(id);
          if (id)
            await locked(conn, "employee_role", "role_id", id, body.version);
          const fields = Object.keys(data);
          if (id)
            await conn.query(
              `UPDATE employee_role SET ${fields.map((key) => `${key} = ?, `).join("")} version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE role_id = ?`,
              [...Object.values(data), actor, roleId],
            );
          else {
            const [insert] = await conn.query(
              `INSERT INTO employee_role (${fields.join(",")}, created_by, updated_by) VALUES (${fields.map(() => "?").join(",")}, ?, ?)`,
              [...Object.values(data), actor, actor],
            );
            roleId = insert.insertId;
          }
          if (grants !== undefined)
            await replaceRolePermissions(conn, roleId, grants, actor);
          return { role_id: roleId };
        },
        "can_edit",
        true,
      );
    },
    async saveFunction(id, actor, body) {
      if (
        !body ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (key) => !["function_name", "is_active", "version"].includes(key),
        )
      )
        throw fail(400, "Function codes are fixed to registered screens.");
      const name = text(body.function_name, "function name", 100, true);
      const active = flag(body.is_active);
      return mutate(
        actor,
        async (conn) => {
          const row = await locked(
            conn,
            "employee_function",
            "function_id",
            id,
            body.version,
          );
          if (!screenKey(row.function_code))
            throw fail(400, "This screen is not registered.");
          await conn.query(
            "UPDATE employee_function SET function_name = ?, is_active = ?, version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE function_id = ?",
            [name, active, actor, id],
          );
          return { function_id: idOf(id) };
        },
        "can_edit",
        true,
      );
    },
    async documentSource(id, key) {
      if (!DOC_KEYS.includes(key)) throw fail(400, "Unknown document type.");
      return read(async (conn) => {
        const [rows] = await conn.query(
          `SELECT ${key} AS source FROM employee WHERE emp_id = ? AND is_deleted = 0`,
          [idOf(id)],
        );
        if (!rows[0]?.source) throw fail(404, "Document not found.");
        return rows[0].source;
      });
    },
    async attachDocument(id, actor, key, version, source) {
      if (!DOC_KEYS.includes(key)) throw fail(400, "Unknown document type.");
      return mutate(actor, async (conn, access) => {
        const row = await locked(conn, "employee", "emp_id", id, version);
        if (row.account_type === "superadmin" && !access.is_super_admin)
          throw fail(
            403,
            "Only a super administrator can manage super administrators.",
          );
        await conn.query(
          `UPDATE employee SET ${key} = ?, version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE emp_id = ?`,
          [source, actor, id],
        );
        return detail(conn, id);
      });
    },
  };
}
module.exports = {
  createEmployeeService,
  validatePermissions,
  validateEmployee,
  idOf,
  ids,
  DOC_KEYS,
};
