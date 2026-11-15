const { getAccess, fail, requirePermission } = require("./employeeAccess");
const { enabled } = require("./offers");
function validate(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (k) =>
        ![
          "name",
          "audience",
          "eligibility",
          "discount_percent",
          "max_discount",
          "ride_limit",
          "starts_at_ms",
          "ends_at_ms",
          "status",
          "version",
          "request_key",
        ].includes(k),
    )
  )
    throw fail(400, "Invalid offer details.");
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.trim().length > 100
  )
    throw fail(400, "Enter an offer name up to 100 characters.");
  if (
    !["rider", "driver"].includes(body.audience) ||
    !["next_rides", "first_rides"].includes(body.eligibility) ||
    !["active", "paused", "closed"].includes(body.status)
  )
    throw fail(400, "Choose a valid offer type, eligibility and status.");
  const numeric = (v, min, max, integer = false) =>
    ["string", "number"].includes(typeof v) &&
    /^\d+(?:\.\d{1,2})?$/.test(String(v)) &&
    Number.isFinite(Number(v)) &&
    Number(v) >= min &&
    Number(v) <= max &&
    (!integer || Number.isSafeInteger(Number(v)));
  if (
    !numeric(body.ride_limit, 1, 1000000, true) ||
    !numeric(body.discount_percent, 0.01, 100)
  )
    throw fail(
      400,
      "Enter a positive ride count and a discount from 0.01 to 100%.",
    );
  if (
    body.max_discount != null &&
    body.max_discount !== "" &&
    !numeric(body.max_discount, 0.01, 999999.99)
  )
    throw fail(400, "Maximum discount must be a positive PKR amount.");
  if (
    body.audience === "driver" &&
    (Number(body.discount_percent) !== 100 ||
      (body.max_discount != null && body.max_discount !== ""))
  )
    throw fail(
      400,
      "Driver offers waive the whole platform fee, with no discount cap.",
    );
  if (
    !Number.isSafeInteger(Number(body.starts_at_ms)) ||
    !Number.isSafeInteger(Number(body.ends_at_ms)) ||
    Number(body.starts_at_ms) < 0 ||
    Number(body.ends_at_ms) <= Number(body.starts_at_ms) ||
    Number(body.ends_at_ms) > 8640000000000000
  )
    throw fail(400, "End date must be after start date.");
  return {
    name: body.name.trim(),
    audience: body.audience,
    eligibility: body.eligibility,
    discount_percent: Number(body.discount_percent),
    max_discount:
      body.max_discount == null || body.max_discount === ""
        ? null
        : Number(body.max_discount),
    ride_limit: Number(body.ride_limit),
    starts_at_ms: Number(body.starts_at_ms),
    ends_at_ms: Number(body.ends_at_ms),
    status: body.status,
  };
}
const normalize = (row) => ({
  ...row,
  id: Number(row.id),
  version: Number(row.version),
  ride_limit: Number(row.ride_limit),
  discount_percent: Number(row.discount_percent),
  max_discount: row.max_discount == null ? null : Number(row.max_discount),
  starts_at_ms: Number(row.starts_at_ms),
  ends_at_ms: Number(row.ends_at_ms),
  completed: Number(row.completed || 0),
  reserved: Number(row.reserved || 0),
  benefit_total: Number(row.benefit_total || 0),
});
function createAdminOffers(pool) {
  async function access(conn, actor, lock = false, action='can_view') {
    const a = await getAccess(conn, actor, { lock });
    requirePermission(a,'offers',action);
  }
  return {
    async list(actor) {
      const c = await pool.getConnection();
      try {
        await access(c, actor);
        const [rows] = await c.query(
          `SELECT o.*,COALESCE(s.completed,0) AS completed,COALESCE(s.reserved,0) AS reserved,COALESCE(s.benefit_total,0) AS benefit_total FROM promotions o LEFT JOIN (SELECT p.offer_id,SUM(r.Ride_Status='Completed') AS completed,SUM(r.Ride_Status IN ('Requested','Accepted','Arrived','Started','Ongoing')) AS reserved,SUM(CASE WHEN r.Ride_Status='Completed' THEN p.benefit_amount ELSE 0 END) AS benefit_total FROM ride_promotions p JOIN ride_history r ON r.Ride_ID_Pk=p.ride_id WHERE p.state<>'released' GROUP BY p.offer_id) s ON s.offer_id=o.id ORDER BY o.id DESC LIMIT 500`,
        );
        return {
          enabled: enabled(),
          offers: rows.map(normalize),
          timezone: "Asia/Karachi",
        };
      } catch (e) {
        if (e.code === "ER_NO_SUCH_TABLE")
          throw fail(
            503,
            "Install offers storage using setup:offers -- --apply before creating offers.",
          );
        throw e;
      } finally {
        c.release();
      }
    },
    async save(actor, id, body) {
      const data = validate(body),
        c = await pool.getConnection();
      let started = false;
      try {
        if (
          id &&
          (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)))
        )
          throw fail(400, "Invalid offer ID.");
        if (
          !id &&
          (typeof body.request_key !== "string" ||
            !/^[a-f0-9-]{36}$/i.test(body.request_key))
        )
          throw fail(400, "A creation request key is required.");
        await c.beginTransaction();
        started = true;
        await access(c, actor, true, id ? 'can_edit' : 'can_add');
        let old;
        if (id) {
          const [rows] = await c.query(
            "SELECT * FROM promotions WHERE id=? FOR UPDATE",
            [id],
          );
          old = rows[0];
          if (!old) throw fail(404, "Offer not found.");
          if (Number(body.version) !== Number(old.version))
            throw fail(409, "Offer changed elsewhere. Reload before editing.");
          if (
            old.audience !== data.audience ||
            old.eligibility !== data.eligibility
          )
            throw fail(
              400,
              "Audience and count basis cannot be changed. Create a new offer instead.",
            );
          if (old.status === "closed" && data.status !== "closed")
            throw fail(
              409,
              "Closed offers cannot be reopened. Create a new offer for a fresh quota.",
            );
          await c.query(
            `UPDATE promotions SET ${Object.keys(data)
              .map((k) => `${k}=?`)
              .join(",")},version=version+1,updated_by=? WHERE id=?`,
            [...Object.values(data), actor, id],
          );
        } else {
          const [prior] = await c.query(
            "SELECT * FROM promotions WHERE request_key=? FOR UPDATE",
            [body.request_key],
          );
          if (prior.length) {
            const existing = prior[0];
            if (
              Number(existing.created_by) !== Number(actor) ||
              JSON.stringify(
                validate(
                  Object.fromEntries(
                    Object.keys(data).map((k) => [k, existing[k]]),
                  ),
                ),
              ) !== JSON.stringify(data)
            )
              throw fail(
                409,
                "This request key was already used. Reload the saved offer.",
              );
            await c.commit();
            started = false;
            return normalize(existing);
          }
          const [created] = await c.query(
            `INSERT INTO promotions (request_key,${Object.keys(data).join(",")},created_by,updated_by) VALUES (?,${Object.keys(
              data,
            )
              .map(() => "?")
              .join(",")},?,?)`,
            [body.request_key, ...Object.values(data), actor, actor],
          );
          id = created.insertId;
        }
        await c.query(
          "INSERT INTO promotion_audit (offer_id,actor_id,before_json,after_json) VALUES (?,?,?,?)",
          [id, actor, old ? JSON.stringify(old) : null, JSON.stringify(data)],
        );
        const [[saved]] = await c.query("SELECT * FROM promotions WHERE id=?", [
          id,
        ]);
        await c.commit();
        started = false;
        return normalize(saved);
      } catch (e) {
        if (started) await c.rollback().catch(() => {});
        if (e.code === "ER_NO_SUCH_TABLE")
          throw fail(503, "Install offers storage before saving.");
        if (
          ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "ER_DUP_ENTRY"].includes(
            e.code,
          )
        )
          throw fail(
            409,
            "Offer changed concurrently. Retry the same request.",
          );
        throw e;
      } finally {
        c.release();
      }
    },
    async usage(actor, id, page = 1) {
      if (
        !/^[1-9]\d*$/.test(String(id)) ||
        !Number.isInteger(Number(page)) ||
        Number(page) < 1 ||
        Number(page) > 100000
      )
        throw fail(400, "Invalid offer or page.");
      const c = await pool.getConnection();
      try {
        await access(c, actor);
        const [rows] = await c.query(
          `SELECT p.actor_user_id,u.User_Name AS name,u.Mobile AS phone,COUNT(CASE WHEN r.Ride_Status='Completed' THEN 1 END) AS completed,COUNT(CASE WHEN r.Ride_Status IN ('Requested','Accepted','Arrived','Started','Ongoing') THEN 1 END) AS reserved,COALESCE(SUM(CASE WHEN r.Ride_Status='Completed' THEN p.benefit_amount ELSE 0 END),0) AS benefit_total FROM ride_promotions p JOIN ride_history r ON r.Ride_ID_Pk=p.ride_id JOIN users u ON u.User_ID_Pk=p.actor_user_id WHERE p.offer_id=? AND p.state<>'released' GROUP BY p.actor_user_id,u.User_Name,u.Mobile ORDER BY p.actor_user_id DESC LIMIT 21 OFFSET ?`,
          [id, (Number(page) - 1) * 20],
        );
        return {
          rows: rows
            .slice(0, 20)
            .map((r) => ({
              ...r,
              completed: Number(r.completed),
              reserved: Number(r.reserved),
              benefit_total: Number(r.benefit_total),
            })),
          has_more: rows.length > 20,
          page: Number(page),
        };
      } finally {
        c.release();
      }
    },
  };
}
module.exports = { createAdminOffers, validate };
