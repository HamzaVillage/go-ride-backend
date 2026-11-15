const SCREENS = Object.freeze([
  ["overview", "Overview", "/"],
  ["rides", "Rides", "/rides"],
  ["drivers", "Drivers", "/drivers"],
  ["riders", "Riders", "/riders"],
  ["franchises", "Franchises", "/franchises"],
  ["reports", "Chat reports", "/reports"],
  ["support", "Support queries", "/support"],
  ["notifications", "Notifications", "/notifications"],
  ["settings", "Settings", "/settings"],
  ["employees", "Employee access", "/employees"],
  ["city_to_city_drivers", "City-to-City Drivers", "/drivers/city-to-city"],
  ["city_to_city_fares", "City-to-City Service & Fares", "/city-to-city/fares"],
  ["city_to_city_routes", "City-to-City Route Fares", "/city-to-city/routes"],
  [
    "city_to_city_calculator",
    "City-to-City Fare Calculator",
    "/city-to-city/calculator",
  ],
  ["franchise_members", "Franchise Drivers & Riders", "/franchise-members"],
  ["offers", "Offers", "/offers"],
]);
const fail = (status, message) => Object.assign(new Error(message), { status });
// Public catalog codes supplied by the admin, independent of auto-increment IDs.
const NUMBERED_SCREENS = [
  "overview",
  "rides",
  "drivers",
  "riders",
  "franchises",
  "reports",
  "support",
  "notifications",
  "settings",
  "employees",
  "offers",
  "city_to_city_drivers",
  "city_to_city_fares",
  "city_to_city_routes",
  "city_to_city_calculator",
  "franchise_members",
];
const ACTIONS = ["can_view", "can_add", "can_edit", "can_delete"];
function screenKey(value) {
  const code = String(value ?? "");
  if (SCREENS.some(([key]) => key === code)) return code;
  if (/^\d{1,2}$/.test(code)) return NUMBERED_SCREENS[Number(code) - 1] || null;
  return null;
}
function can(access, screen, action = "can_view") {
  return Boolean(
    access?.is_super_admin || access?.permissions?.[screen]?.[action],
  );
}
function requirePermission(access, screen, action = "can_view") {
  if (!can(access, screen, "can_view") || !can(access, screen, action))
    throw fail(
      403,
      `Your role does not allow ${action.replace("can_", "")} on this screen.`,
    );
}
function requestAction(req) {
  const method = (req.method || "GET").toUpperCase();
  const path = (req.originalUrl || req.path || req.url || "").split("?")[0];
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return "can_view";
  if (method === "DELETE" || req.body?.is_deleted === true) return "can_delete";
  if (
    method === "POST" &&
    (/\/(fare-preview|city-to-city-calculator)$/.test(path) ||
      /\/settings\/backup$/.test(path))
  )
    return "can_view";
  if (
    ["PATCH", "PUT"].includes(method) ||
    /\/(documents|review|approve|reject|status)(\/|$)/.test(path)
  )
    return "can_edit";
  return "can_add";
}
async function getAccess(conn, employeeId, { lock = false } = {}) {
  const locking = lock ? " LOCK IN SHARE MODE" : "";
  const [employees] = await conn.query(
    "SELECT emp_id, account_type, is_active, is_deleted, (SELECT franchise_id FROM employee_franchise_access WHERE employee_id=employee.emp_id) AS franchise_id FROM employee WHERE emp_id = ?" +
      locking,
    [employeeId],
  );
  const employee = employees[0];
  if (!employee || !Number(employee.is_active) || Number(employee.is_deleted))
    throw fail(401, "This employee account is inactive or unavailable.");
  const permissions = {};
  if (employee.account_type === "superadmin") {
    for (const [code] of SCREENS)
      permissions[code] = Object.fromEntries(
        ACTIONS.map((action) => [action, true]),
      );
    return {
      is_super_admin: true,
      employee_id: Number(employee.emp_id),
      functions: SCREENS.map(([code]) => code),
      permissions,
    };
  }
  if (employee.account_type !== "employee")
    throw fail(401, "Invalid employee account type.");
  const [functions] = await conn.query(
    `SELECT DISTINCT f.function_code,af.can_view,af.can_add,af.can_edit,af.can_delete FROM assign_role a
        JOIN employee_role r ON r.role_id = a.role_id AND r.is_active = 1 AND r.is_deleted = 0
        JOIN assign_role_function af ON af.role_id = r.role_id AND af.is_active = 1 AND af.is_deleted = 0
        JOIN employee_function f ON f.function_id = af.function_id AND f.is_active = 1 AND f.is_deleted = 0
        WHERE a.emp_id = ? AND a.is_active = 1 AND a.is_deleted = 0${locking}`,
    [employee.emp_id],
  );
  for (const row of functions) {
    const code = screenKey(row.function_code);
    if (!code) continue;
    const grant = (permissions[code] ||= Object.fromEntries(
      ACTIONS.map((action) => [action, false]),
    ));
    for (const action of ACTIONS) grant[action] ||= Number(row[action]) === 1;
  }
  let franchise = null;
  if (employee.franchise_id != null) {
    const [rows] = await conn.query("SELECT id,company_name,city,status FROM franchiser WHERE id=?" + locking, [employee.franchise_id]);
    if (!rows.length || rows[0].status !== 'active') throw fail(403, 'Your assigned franchise is inactive or unavailable. Contact a super administrator.');
    franchise = {id:Number(rows[0].id),name:rows[0].company_name,city:rows[0].city};
    const allowed = new Set(['overview','rides','drivers','riders','franchises','franchise_members']);
    for (const code of Object.keys(permissions)) {
      if (!allowed.has(code)) delete permissions[code];
    }
    // Franchise profiles are managed centrally. Staff can view their own profile.
    if (permissions.franchises) for (const a of ACTIONS.slice(1)) permissions.franchises[a] = false;
  }
  return {
    franchise,
    is_super_admin: false,
    employee_id: Number(employee.emp_id),
    functions: Object.keys(permissions).filter(
      (code) => permissions[code].can_view,
    ),
    permissions,
  };
}
async function requireFranchiseResource(conn, access, kind, id, lock = false) {
  if (!access?.franchise) return;
  const spec = {drivers:['drivers','id'], riders:['users','User_ID_Pk'], franchises:['franchiser','id']}[kind];
  if (!spec || !/^[1-9]\d*$/.test(String(id))) throw fail(404, 'Record not found.');
  const [table,key] = spec;
  const clause = kind === 'franchises' ? 'id' : 'Franchiser_ID_FK';
  const [rows] = await conn.query(`SELECT ${key} FROM ${table} WHERE ${key}=? AND ${clause}=?${lock ? ' FOR UPDATE' : ''}`, [id,access.franchise.id]);
  if (!rows.length) throw fail(404, 'Record not found in your franchise.');
}
function createAccessMiddleware(pool, screen, action) {
  return async (req, res, next) => {
    let conn;
    try {
      conn = await pool.getConnection();
      req.access = await getAccess(conn, req.user.employeeId);
      if (screen)
        requirePermission(req.access, screen, action || requestAction(req));
      if (
        screen &&
        req.body?.is_deleted === true &&
        Object.keys(req.body).some(
          (key) => !["is_deleted", "version", "id"].includes(key),
        )
      )
        requirePermission(req.access, screen, "can_edit");
      if (req.access.franchise && screen) {
        const segments = (req.originalUrl || req.url || '').split('?')[0].split('/').filter(Boolean);
        const normalized = segments.map(segment=>segment.toLowerCase());
        const index = normalized.indexOf('admin');
        const resource = normalized[index + 1], id = segments[index + 2];
        if (['drivers','riders','franchises'].includes(resource) && id)
          await requireFranchiseResource(conn,req.access,resource,id);
        if (resource === 'drivers' && !id && req.method === 'POST')
          throw fail(403, 'Add drivers through Franchise Drivers & Riders.');
      }
      next();
    } catch (error) {
      if (!error.status)
        console.error(
          "Employee authorization failed:",
          error.code || "INTERNAL_ERROR",
        );
      res.status(error.status || 503).json({
        success: false,
        message: error.status
          ? error.message
          : "Unable to verify access. Please check role-permission storage.",
      });
    } finally {
      conn?.release();
    }
  };
}
// Legacy configured service keys remain available to their existing integrations.
// Signed admin sessions always pass through current, database-backed permissions.
function withScreenAccess(legacyMiddleware, screen) {
  return (req, res, next) =>
    legacyMiddleware(req, res, () => {
      if (!req.user) return next();
      return createAccessMiddleware(require("../db/Connect_Db"), screen)(
        req,
        res,
        next,
      );
    });
}
module.exports = {
  SCREENS,
  requireFranchiseResource,
  NUMBERED_SCREENS,
  ACTIONS,
  screenKey,
  can,
  requirePermission,
  requestAction,
  fail,
  getAccess,
  createAccessMiddleware,
  withScreenAccess,
};
