const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const {
  getAccess,
  screenKey,
  requestAction,
  requirePermission,
  NUMBERED_SCREENS,
  createAccessMiddleware,
} = require("../services/employeeAccess");
const {
  validatePermissions,
  createEmployeeService,
} = require("../services/adminEmployees");
const grant = (code, flags = {}) => ({
  function_code: code,
  can_view: 0,
  can_add: 0,
  can_edit: 0,
  can_delete: 0,
  ...flags,
});
function poolFor(rows) {
  let calls = 0;
  const conn = {
    release() {},
    async query(sql) {
      calls++;
      if (sql.includes("FROM employee WHERE"))
        return [
          [
            {
              emp_id: 7,
              account_type: "employee",
              is_active: 1,
              is_deleted: 0,
            },
          ],
        ];
      if (sql.includes("FROM assign_role a")) return [rows];
      throw new Error(sql);
    },
  };
  return {
    pool: { getConnection: async () => conn },
    conn,
    get calls() {
      return calls;
    },
  };
}
test("all 16 numeric codes match the supplied catalog and legacy aliases still work", () => {
  NUMBERED_SCREENS.forEach((key, index) => {
    assert.equal(screenKey(String(index + 1).padStart(2, "0")), key);
    assert.equal(screenKey(key), key);
  });
  assert.equal(screenKey("11"), "offers");
  assert.equal(screenKey("12"), "city_to_city_drivers");
  assert.equal(screenKey("00"), null);
  assert.equal(screenKey("17"), null);
});
test("role grants union actions while all-zero assignments give no screen access", async () => {
  const f = poolFor([
    grant("03", { can_view: 1 }),
    grant("drivers", { can_edit: 1 }),
    grant("11"),
  ]);
  const a = await getAccess(f.conn, 7);
  assert.deepEqual(a.functions, ["drivers"]);
  assert.equal(a.permissions.drivers.can_edit, true);
  assert.equal(a.permissions.drivers.can_add, false);
  assert.doesNotThrow(() => requirePermission(a, "drivers", "can_edit"));
  assert.throws(() => requirePermission(a, "drivers", "can_add"), {
    status: 403,
  });
});
test("a write bit without view never opens or writes a screen", async () => {
  const a = await getAccess(poolFor([grant("03", { can_edit: 1 })]).conn, 7);
  assert.deepEqual(a.functions, []);
  assert.throws(() => requirePermission(a, "drivers", "can_edit"), {
    status: 403,
  });
});
test("permission validation rejects malformed IDs, duplicates, unknown flags and hidden writes", () => {
  const base = {
    function_id: 3,
    can_view: true,
    can_add: false,
    can_edit: false,
    can_delete: false,
  };
  assert.deepEqual(validatePermissions([base]), [base]);
  for (const rows of [
    [base, base],
    [{ ...base, can_add: 1 }],
    [{ ...base, can_view: false, can_edit: true }],
    [{ ...base, admin: true }],
    [{ ...base, function_id: "3 OR 1" }],
  ])
    assert.throws(() => validatePermissions(rows), { status: 400 });
});
test("request classification distinguishes real writes from read-only POST calculators", () => {
  for (const [method, path, action] of [
    ["POST", "/admin/drivers", "can_add"],
    ["PATCH", "/admin/drivers/1/profile", "can_edit"],
    ["POST", "/admin/drivers/1/documents/photo", "can_edit"],
    ["POST", "/admin/city-to-city-drivers/1/topups/2/review", "can_edit"],
    ["POST", "/admin/drivers/1/topups", "can_add"],
    ["POST", "/admin/settings/fare-preview", "can_view"],
    ["POST", "/admin/city-to-city-calculator", "can_view"],
    ["DELETE", "/admin/employees/1", "can_delete"],
  ])
    assert.equal(requestAction({ method, originalUrl: path }), action);
  assert.equal(
    requestAction({ method: "PATCH", body: { is_deleted: true } }),
    "can_delete",
  );
});
test("HTTP middleware enforces numeric-code View/Add/Edit/Delete independently and rereads revocations", async (t) => {
  const express = require("express"),
    rows = [grant("03", { can_view: 1 })],
    f = poolFor(rows);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { employeeId: 7 };
    next();
  });
  let writes = 0;
  for (const method of ["get", "post", "patch", "delete"])
    app[method](
      "/drivers",
      createAccessMiddleware(f.pool, "drivers"),
      (req, res) => {
        if (method !== "get") writes++;
        res.json({ success: true });
      },
    );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/drivers`;
  assert.equal((await fetch(url)).status, 200);
  for (const method of ["POST", "PATCH", "DELETE"])
    assert.equal((await fetch(url, { method })).status, 403);
  assert.equal(writes, 0);
  rows[0].can_add = 1;
  assert.equal((await fetch(url, { method: "POST" })).status, 200);
  assert.equal((await fetch(url, { method: "PATCH" })).status, 403);
  rows[0].can_add = 0;
  rows[0].can_edit = 1;
  assert.equal((await fetch(url, { method: "PATCH" })).status, 200);
  assert.equal((await fetch(url, { method: "POST" })).status, 403);
  rows[0].can_edit = 0;
  rows[0].can_delete = 1;
  assert.equal((await fetch(url, { method: "DELETE" })).status, 200);
  assert.equal(
    (
      await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_deleted: true,
          name: "Cannot edit through delete",
        }),
      })
    ).status,
    403,
  );
  rows[0].can_view = 0;
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, { method: "PATCH" })).status, 403);
  assert.equal(writes, 3);
});
test("employees cannot escalate through role writes even with Employee access Edit granted", async () => {
  const f = poolFor([grant("10", { can_view: 1, can_edit: 1 })]);
  f.conn.beginTransaction = async () => {};
  f.conn.rollback = async () => {};
  f.conn.commit = async () => {};
  await assert.rejects(
    createEmployeeService(f.pool).saveRole(null, 7, {
      role_name: "Escalation",
      permissions: [],
    }),
    { status: 403 },
  );
});
test("role permission installer only adds missing columns with default deny", async () => {
  const { configure } = require("../scripts/configureRolePermissions");
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      return [
        sql.startsWith("SHOW")
          ? [{ Field: "can_view" }, { Field: "can_edit" }]
          : {},
      ];
    },
  };
  assert.deepEqual((await configure(db)).missing_columns, [
    "can_add",
    "can_delete",
  ]);
  assert.equal(queries.length, 1);
  await configure(db, { apply: true });
  assert.equal(queries.length, 3);
  assert.match(queries.at(-1), /DEFAULT 0/);
  assert.doesNotMatch(queries.at(-1), /can_view|can_edit/);
});

test("catalog permissions round-trip into the role-save validator without internal assignment fields", async () => {
  const db = {
    getConnection: async () => ({
      release() {},
      async query(sql) {
        if (sql.includes("FROM employee_role"))
          return [
            [
              {
                role_id: 1,
                role_name: "Operations",
                is_active: 1,
                is_deleted: 0,
              },
            ],
          ];
        if (sql.includes("FROM assign_role_function"))
          return [
            [
              {
                role_id: 1,
                function_id: 3,
                can_view: 1,
                can_add: 0,
                can_edit: 1,
                can_delete: 0,
              },
            ],
          ];
        if (sql.includes("FROM employee_function"))
          return [
            [
              {
                function_id: 3,
                function_code: "03",
                function_name: "Drivers",
                is_active: 1,
                is_deleted: 0,
              },
            ],
          ];
        throw new Error(sql);
      },
    }),
  };
  const catalog = await createEmployeeService(db).catalog();
  assert.deepEqual(catalog.roles[0].permissions, [
    {
      function_id: 3,
      can_view: true,
      can_add: false,
      can_edit: true,
      can_delete: false,
    },
  ]);
  assert.doesNotThrow(() => validatePermissions(catalog.roles[0].permissions));
});

test("delete-only employee access cannot modify profile fields through a soft-delete payload", async () => {
  const f = poolFor([grant("10", { can_view: 1, can_delete: 1 })]);
  f.conn.beginTransaction = async () => {};
  f.conn.rollback = async () => {};
  f.conn.commit = async () => {};
  await assert.rejects(
    createEmployeeService(f.pool).saveEmployee(8, 7, {
      version: 1,
      is_deleted: true,
      name: "Forbidden edit",
    }),
    { status: 403 },
  );
});
