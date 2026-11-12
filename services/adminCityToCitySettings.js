const crypto = require("node:crypto");
const { getAccess, fail } = require("./employeeAccess");
const { calculateCityFare } = require("./cityToCityPricing");
const numericFields = {
  base_fare: [0, 99999999.99],
  per_km_rate: [0, 99999999.99],
  per_minute_rate: [0, 99999999.99],
  minimum_fare: [0, 99999999.99],
  maximum_fare: [0, 99999999.99, true],
  fixed_fare: [0, 99999999.99, true],
  included_distance_km: [0, 99999999.99],
  included_duration_minutes: [0, 100000, false, false],
  included_weight_kg: [0, 999999.99],
  extra_per_kg_rate: [0, 99999999.99],
  booking_fee: [0, 99999999.99],
  tax_percent: [0, 100],
  commission_percent: [0, 100],
  commission_fixed: [0, 99999999.99],
  max_discount_percent: [0, 100],
  max_markup_percent: [0, 100],
  rounding_increment: [1, 999999.99],
  min_passengers: [1, 30, true, false],
  max_passengers: [1, 30, true, false],
  max_parcel_weight_kg: [0.01, 999999.99, true],
  minimum_notice_minutes: [0, 100000, false, false],
  request_expiry_minutes: [1, 100000, false, false],
  sort_order: [0, 65535, false, false],
};
const flags = [
  "is_active",
  "is_pricing_enabled",
  "allows_negotiation",
  "allows_now",
  "allows_scheduled",
];
const strings = {
  name: 150,
  name_ur: 150,
  description: 4000,
  description_ur: 4000,
};
const serviceFields = [
  ...Object.keys(numericFields),
  ...flags,
  ...Object.keys(strings),
  "fare_model",
];
const routeFields = serviceFields.filter(
  (k) =>
    ![
      "min_passengers",
      "max_passengers",
      "max_parcel_weight_kg",
      "minimum_notice_minutes",
      "request_expiry_minutes",
      "sort_order",
      "allows_now",
      "allows_scheduled",
      "name_ur",
      "description",
      "description_ur",
    ].includes(k),
);
const version = (row) =>
  crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
const id = (value) => {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw fail(400, "Invalid record ID.");
  return Number(value);
};
function validateChanges(body, current, route = false) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !Object.keys(body).length
  )
    throw fail(400, "Choose at least one change.");
  const allowed = route ? routeFields : serviceFields,
    result = {};
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.includes(key)) throw fail(400, `Cannot edit ${key}.`);
    if (numericFields[key]) {
      const [min, max, nullable, decimal = true] = numericFields[key];
      if ((value === null || value === "") && nullable) {
        result[key] = null;
        continue;
      }
      if (
        !["number", "string"].includes(typeof value) ||
        String(value).trim() === "" ||
        !Number.isFinite(Number(value)) ||
        Number(value) < min ||
        Number(value) > max ||
        (!decimal && !Number.isInteger(Number(value))) ||
        Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) >
          0.00001
      )
        throw fail(400, `Invalid ${key.replaceAll("_", " ")}.`);
      result[key] = Number(value);
    } else if (flags.includes(key)) {
      if (![true, false, 0, 1].includes(value))
        throw fail(400, `Invalid ${key}.`);
      result[key] = Number(value);
    } else if (key === "fare_model") {
      if (!["fixed", "distance"].includes(value))
        throw fail(400, "Choose fixed or distance pricing.");
      result[key] = value;
    } else {
      if (
        typeof value !== "string" ||
        value.length > (key === "name" && !route ? 100 : strings[key]) ||
        (key === "name" && !value.trim())
      )
        throw fail(400, `Invalid ${key}.`);
      result[key] = value.trim();
    }
  }
  const next = { ...current, ...result };
  if (next.fare_model === "fixed" && next.fixed_fare == null)
    throw fail(400, "A fixed fare is required.");
  if (
    next.maximum_fare != null &&
    Number(next.maximum_fare) < Number(next.minimum_fare)
  )
    throw fail(400, "Maximum fare must be at least the minimum fare.");
  if (
    !route &&
    current.code !== "parcel" &&
    (next.min_passengers == null ||
      (next.max_passengers != null &&
        Number(next.max_passengers) < Number(next.min_passengers)))
  )
    throw fail(400, "Check passenger limits.");
  if (
    !route &&
    current.code === "parcel" &&
    (next.min_passengers != null || next.max_passengers != null)
  )
    throw fail(400, "Parcel services do not use passenger limits.");
  return result;
}
function createAdminCityToCitySettings(pool) {
  async function access(conn, actor, screen) {
    const a = await getAccess(conn, actor, { lock: true });
    if (!a.functions.includes(screen))
      throw fail(403, "This screen is not assigned to your role.");
  }
  async function transaction(action) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const r = await action(conn);
      await conn.commit();
      return r;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }
  const decorate = (row) => ({ ...row, version: version(row) });
  async function snapshot(conn, table, recordId, lock = false) {
    const [rows] = await conn.query(
      `SELECT * FROM ${table} WHERE id=?${lock ? " FOR UPDATE" : ""}`,
      [id(recordId)],
    );
    if (!rows.length) throw fail(404, "Record not found.");
    return rows[0];
  }
  return {
    async services() {
      const [rows] = await pool.query(
        "SELECT * FROM city_to_city_services ORDER BY sort_order,id",
      );
      return rows.map(decorate);
    },
    async routes() {
      const [rows] = await pool.query(
        "SELECT * FROM city_to_city_fare_rates ORDER BY id DESC LIMIT 500",
      );
      const [cities] = await pool.query(
        "SELECT ID_PK AS id,City_Name AS name FROM city ORDER BY City_Name",
      );
      const [services] = await pool.query(
        "SELECT id,code,name FROM city_to_city_services ORDER BY sort_order,id",
      );
      return { rates: rows.map(decorate), cities, services };
    },
    async save(kind, recordId, actor, body = {}) {
      const route = kind === "routes",
        table = route ? "city_to_city_fare_rates" : "city_to_city_services",
        screen = route ? "city_to_city_routes" : "city_to_city_fares";
      return transaction(async (conn) => {
        await access(conn, actor, screen);
        const row = await snapshot(conn, table, recordId, true);
        if (body.version !== version(row))
          throw fail(
            409,
            "This tariff changed elsewhere. Reload it before saving.",
          );
        const changes = validateChanges(body.changes, row, route);
        await conn.query(
          `UPDATE ${table} SET ${Object.keys(changes)
            .map((k) => `${k}=?`)
            .join(",")},updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          [...Object.values(changes), actor, id(recordId)],
        );
        return decorate(await snapshot(conn, table, recordId));
      });
    },
    async createRoute(actor, body = {}) {
      return transaction(async (conn) => {
        await access(conn, actor, "city_to_city_routes");
        const service = await snapshot(
          conn,
          "city_to_city_services",
          body.service_id,
        );
        const origin = id(body.origin_city_id),
          destination = id(body.destination_city_id);
        if (origin === destination)
          throw fail(400, "Choose different origin and destination cities.");
        const [cities] = await conn.query(
          "SELECT ID_PK FROM city WHERE ID_PK IN (?,?)",
          [origin, destination],
        );
        if (cities.length !== 2) throw fail(400, "Choose valid cities.");
        const values = Object.fromEntries(
          routeFields.map((k) => [k, service[k]]),
        );
        values.name = `${service.name} route`;
        values.is_active = 0;
        const changes = validateChanges(
          { ...values, ...body.changes },
          service,
          true,
        );
        const [result] = await conn.query(
          `INSERT INTO city_to_city_fare_rates (service_id,origin_city_id,destination_city_id,valid_from,created_by,updated_by,${Object.keys(changes).join(",")}) VALUES (?,?,?,NOW(),?,?,${Object.keys(
            changes,
          )
            .map(() => "?")
            .join(",")})`,
          [
            service.id,
            origin,
            destination,
            actor,
            actor,
            ...Object.values(changes),
          ],
        );
        return decorate(
          await snapshot(conn, "city_to_city_fare_rates", result.insertId),
        );
      });
    },
    async preview(body = {}) {
      const service = await snapshot(
        pool,
        "city_to_city_services",
        body.service_id,
      );
      const origin = id(body.origin_city_id),
        destination = id(body.destination_city_id);
      if (origin === destination) throw fail(400, "Choose different cities.");
      const [rows] = await pool.query(
        "SELECT * FROM city_to_city_fare_rates WHERE service_id=? AND origin_city_id=? AND destination_city_id=? AND vehicle_type IS NULL AND is_active=1 AND valid_from<=NOW() AND (valid_until IS NULL OR valid_until>NOW()) ORDER BY priority DESC,id DESC LIMIT 1",
        [service.id, origin, destination],
      );
      const rate = rows[0] ? { ...service, ...rows[0] } : service;
      for (const key of ["distance_km", "duration_minutes"])
        if (
          !["number", "string"].includes(typeof body[key]) ||
          String(body[key]).trim() === "" ||
          !Number.isFinite(Number(body[key])) ||
          Number(body[key]) < 0 ||
          Number(body[key]) > 100000
        )
          throw fail(400, `Invalid ${key}.`);
      const persons = Number(body.passenger_count),
        weight = Number(body.parcel_weight_kg);
      if (
        service.code !== "parcel" &&
        (!Number.isInteger(persons) ||
          persons < Number(service.min_passengers || 1) ||
          persons > Number(service.max_passengers || 30))
      )
        throw fail(400, "Invalid passenger count.");
      if (
        service.code === "parcel" &&
        (!Number.isFinite(weight) ||
          weight <= 0 ||
          weight > Number(service.max_parcel_weight_kg || 999999.99))
      )
        throw fail(400, "Invalid parcel weight.");
      return {
        ...calculateCityFare(
          rate,
          {
            distance_km: Number(body.distance_km),
            duration_minutes: Number(body.duration_minutes),
            passenger_count: persons,
            parcel_weight_kg: weight,
          },
          service.code,
        ),
        tariff_name: rate.name,
        source: rows[0] ? "Route tariff" : "Service default",
        service_active: Boolean(Number(service.is_active)),
      };
    },
  };
}
module.exports = { createAdminCityToCitySettings, validateChanges, version };
