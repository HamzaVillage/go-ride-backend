const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdminOffers } = require("../services/adminOffers");
const body = () => ({
  request_key: "01234567-89ab-4def-8123-0123456789ab",
  name: "First rides",
  audience: "rider",
  eligibility: "next_rides",
  discount_percent: 30,
  max_discount: 100,
  ride_limit: 3,
  starts_at_ms: Date.now() - 1000,
  ends_at_ms: Date.now() + 86400000,
  status: "active",
});
function fixture({ denied = false, failAudit = false } = {}) {
  const state = {
    rows: [],
    audits: [],
    calls: [],
    commits: 0,
    rollbacks: 0,
    released: 0,
  };
  let next = 1;
  const conn = {
    stage: null,
    async beginTransaction() {
      this.stage = structuredClone({ rows: state.rows, audits: state.audits });
    },
    async commit() {
      state.rows = this.stage.rows;
      state.audits = this.stage.audits;
      this.stage = null;
      state.commits++;
    },
    async rollback() {
      this.stage = null;
      state.rollbacks++;
    },
    release() {
      state.released++;
    },
    async query(sql, args = []) {
      state.calls.push({ sql, args });
      const current = this.stage || state;
      if (sql.includes("FROM employee WHERE"))
        return [
          [
            {
              emp_id: 7,
              account_type: denied ? "employee" : "superadmin",
              is_active: 1,
              is_deleted: 0,
            },
          ],
        ];
      if (sql.includes("SELECT DISTINCT")) return [[]];
      if (sql.startsWith("SELECT * FROM promotions WHERE request_key"))
        return [current.rows.filter((r) => r.request_key === args[0])];
      if (sql.startsWith("SELECT * FROM promotions WHERE id"))
        return [current.rows.filter((r) => r.id === Number(args[0]))];
      if (sql.startsWith("INSERT INTO promotions")) {
        const keys = sql
          .match(/INSERT INTO promotions \(([^)]+)\)/)[1]
          .split(",");
        const row = {
          id: next++,
          version: 1,
          ...Object.fromEntries(keys.map((key, i) => [key, args[i]])),
        };
        current.rows.push(row);
        return [{ insertId: row.id }];
      }
      if (sql.startsWith("UPDATE promotions")) {
        const row = current.rows.find((r) => r.id === Number(args.at(-1)));
        const keys = sql
          .slice(sql.indexOf(" SET ") + 5, sql.indexOf(",version="))
          .split(",")
          .map((v) => v.split("=")[0]);
        keys.forEach((key, i) => (row[key] = args[i]));
        row.version++;
        row.updated_by = args.at(-2);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("INSERT INTO promotion_audit")) {
        if (failAudit) throw new Error("Audit unavailable");
        current.audits.push(args);
        return [{ insertId: 1 }];
      }
      if (sql.startsWith("SELECT o.*")) return [current.rows];
      throw new Error(sql);
    },
  };
  return {
    state,
    service: createAdminOffers({ getConnection: async () => conn }),
  };
}
test("creation and a lost-response retry recover one campaign ID without resetting usage", async () => {
  const f = fixture(),
    request = body();
  const first = await f.service.save(7, null, request);
  const retry = await f.service.save(7, null, request);
  assert.equal(first.id, retry.id);
  assert.equal(f.state.rows.length, 1);
  assert.equal(f.state.audits.length, 1);
  await assert.rejects(f.service.save(8, null, request), { status: 409 });
  await assert.rejects(
    f.service.save(7, null, { ...request, ride_limit: 10 }),
    { status: 409 },
  );
  assert.equal(f.state.rows.length, 1);
});
test("editing dates, quota or status never writes to redemption counters; stale edits are rejected", async () => {
  const f = fixture(),
    original = body(),
    saved = await f.service.save(7, null, original);
  const edited = await f.service.save(7, saved.id, {
    ...original,
    version: 1,
    status: "paused",
    ride_limit: 10,
  });
  assert.equal(edited.id, saved.id);
  assert.equal(edited.version, 2);
  assert.equal(edited.ride_limit, 10);
  await assert.rejects(
    f.service.save(7, saved.id, { ...original, version: 1 }),
    { status: 409 },
  );
  assert.equal(
    f.state.calls.some((q) =>
      /^(UPDATE|DELETE|INSERT).*ride_promotions/.test(q.sql),
    ),
    false,
  );
  const resumed = await f.service.save(7, saved.id, {
    ...original,
    version: 2,
  });
  assert.equal(resumed.id, saved.id);
  assert.equal(f.state.rows.length, 1);
});
test("audience and lifetime basis cannot be changed, and closed offers cannot reopen", async () => {
  const f = fixture(),
    request = body(),
    saved = await f.service.save(7, null, request);
  await assert.rejects(
    f.service.save(7, saved.id, {
      ...request,
      version: 1,
      eligibility: "first_rides",
    }),
    { status: 400 },
  );
  await assert.rejects(
    f.service.save(7, saved.id, {
      ...request,
      version: 1,
      audience: "driver",
      discount_percent: 100,
      max_discount: null,
    }),
    { status: 400 },
  );
  const closed = await f.service.save(7, saved.id, {
    ...request,
    version: 1,
    status: "closed",
  });
  await assert.rejects(
    f.service.save(7, saved.id, {
      ...request,
      version: closed.version,
      status: "active",
    }),
    { status: 409 },
  );
  const newOffer = await f.service.save(7, null, {
    ...request,
    request_key: "11234567-89ab-4def-8123-0123456789ab",
  });
  assert.notEqual(newOffer.id, saved.id);
});
test("permission or audit failure leaves no partially created offer", async () => {
  const denied = fixture({ denied: true });
  await assert.rejects(denied.service.save(7, null, body()), { status: 403 });
  assert.equal(denied.state.rows.length, 0);
  const failed = fixture({ failAudit: true });
  await assert.rejects(
    failed.service.save(7, null, body()),
    /Audit unavailable/,
  );
  assert.equal(failed.state.rows.length, 0);
  assert.equal(failed.state.audits.length, 0);
  assert.equal(failed.state.rollbacks, 1);
});
