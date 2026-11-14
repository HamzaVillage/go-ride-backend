const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function fixture({ enabled = true, conflict = false } = {}) {
  const calls = [];
  let active = false,
    committed = false,
    rollback = false,
    inserted = false;
  const conn = {
    async beginTransaction() {
      calls.push("begin");
      active = true;
    },
    async commit() {
      calls.push("commit");
      committed = true;
      active = false;
    },
    async rollback() {
      rollback = true;
      inserted = false;
      active = false;
    },
    release() {
      assert.equal(active, false);
      calls.push("release");
    },
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("SET TRANSACTION")) return [{}];
      if (sql.includes("FROM users")) return [[{ User_ID_Pk: 42 }]];
      if (sql.includes("Ride_Status IN")) return [[]];
      if (sql.includes("FROM vehicle_fare_rate"))
        return [[{ Platform_Fee_Is_Percentage: 0, Platform_Fee_RS: 15 }]];
      if (sql.startsWith("INSERT INTO ride_history")) {
        assert.equal(active, true);
        inserted = true;
        return [{ insertId: 9 }];
      }
      if (sql.includes("FROM ride_history r")) return [[{ Ride_ID_Pk: 9 }]];
      throw new Error(sql);
    },
  };
  const offers = {
    enabled: () => enabled,
    personalUser: async () => 42,
    riderQuote: async () => ({ discount_base_limit: 500 }),
    reserve: async (c, args) => {
      calls.push("reserve");
      if (!enabled || conflict)
        throw Object.assign(new Error("Your offer changed."), { status: 409 });
      assert.equal(c, conn);
      assert.equal(active, true);
      assert.equal(args.userId, 42);
      assert.equal(args.verifiedLimit, 500);
      return { offer_id: 1, discount_amount: 150, customer_payable: 350 };
    },
  };
  const deps = {
    "../services/offers": offers,
    "../services/platformFee": require("../services/platformFee"),
    "../services/rideCompletionSettlement": {},
    "../services/rideChatService": {},
    "../services/redisCache": {},
    crypto: require("crypto"),
    "../services/rideSearch": {},
    "../services/driverDispatch": {
      validCoordinates: () => true,
      category: () => true,
      getSearchConfig: async () => ({}),
      dispatchRide: async () => {
        assert.equal(committed, true);
        calls.push("dispatch");
      },
    },
    "../db/Connect_Db": { getConnection: async () => conn },
    "../socket/socketManager": { getIO: () => ({}) },
    "../services/pushNotificationService": {},
    "../utils/driverHelper": {},
  };
  const ctx = {
    module: { exports: {} },
    console: { error() {}, log() {}, warn() {} },
    require: (id) => {
      assert.ok(id in deps, id);
      return deps[id];
    },
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../controller/rideController.js"),
      "utf8",
    ),
    ctx,
  );
  return {
    async run() {
      const res = {
        statusCode: 200,
        status(n) {
          this.statusCode = n;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        },
      };
      await ctx.module.exports.createRide(
        {
          user: { userId: 77 },
          body: {
            pickup_location: "A",
            drop_location: "B",
            pickup_lat: 24.86,
            pickup_lng: 67,
            drop_lat: 24.87,
            drop_lng: 67.01,
            fare: 500,
            vehicle_type: "Mini",
            offer_quote: { offer_id: 1, customer_payable: 350 },
          },
        },
        res,
      );
      return { res, calls, inserted, committed, rollback };
    },
  };
}
test("discount reservation and canonical rider are committed before dispatch", async () => {
  const r = await fixture().run();
  assert.equal(r.res.statusCode, 201);
  assert.equal(r.res.body.promotion.customer_payable, 350);
  assert.ok(r.committed);
  assert.ok(r.calls.indexOf("commit") < r.calls.indexOf("dispatch"));
});
test("quota conflict rolls back inserted ride and never dispatches it", async () => {
  const r = await fixture({ conflict: true }).run();
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.inserted, false);
  assert.equal(r.rollback, true);
  assert.ok(!r.calls.includes("dispatch"));
});
test("disabling offers rejects a previously confirmed discount before creating any ride", async () => {
  const r = await fixture({ enabled: false }).run();
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.inserted, false);
  assert.equal(r.committed, false);
  assert.ok(!r.calls.includes("begin"));
});
