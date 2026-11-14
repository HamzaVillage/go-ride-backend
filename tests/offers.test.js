const test = require("node:test");
const assert = require("node:assert/strict");
const offers = require("../services/offers");
const { validate } = require("../services/adminOffers");
const oldFlag = process.env.OFFERS_ENABLED;
test.before(() => {
  process.env.OFFERS_ENABLED = "true";
});
test.after(() => {
  if (oldFlag === undefined) delete process.env.OFFERS_ENABLED;
  else process.env.OFFERS_ENABLED = oldFlag;
});
const active = new Set([
  "Requested",
  "Accepted",
  "Arrived",
  "Started",
  "Ongoing",
]);
const campaign = (id = 1, audience = "rider", extra = {}) => ({
  id,
  name: `Offer ${id}`,
  audience,
  eligibility: "next_rides",
  discount_percent: audience === "driver" ? 100 : 30,
  max_discount: null,
  ride_limit: 3,
  starts_at_ms: Date.now() - 10000,
  ends_at_ms: Date.now() + 86400000,
  status: "active",
  ...extra,
});
function fixture(initialOffers = [campaign()]) {
  const state = {
    offers: initialOffers,
    rides: new Map(),
    redemptions: [],
    calls: [],
    locks: new Map(),
    nextId: 1,
  };
  const ride = (id, user = 42, driver = 100) => {
    const r = {
      Ride_ID_Pk: id,
      User_ID_Fk: user,
      Driver_ID_Fk: driver,
      DriverUser: 42,
      Ride_Status: "Requested",
      Fare: 500,
      Organization_Fee: 15,
      Customer_Payable: null,
      Rider_Discount: 0,
    };
    state.rides.set(id, r);
    return r;
  };
  function connection() {
    let pending = [],
      changes = new Map(),
      held = new Map();
    const records = () => [...state.redemptions, ...pending];
    const r = (id) => changes.get(Number(id)) || state.rides.get(Number(id));
    async function lock(id) {
      if (held.has(id)) return;
      const previous = state.locks.get(id) || Promise.resolve();
      let unlock;
      const tail = new Promise((resolve) => {
        unlock = resolve;
      });
      state.locks.set(id, tail);
      await previous;
      held.set(id, unlock);
    }
    const clear = () => {
      for (const unlock of held.values()) unlock();
      held.clear();
      pending = [];
      changes.clear();
    };
    const update = (id, fields) =>
      changes.set(Number(id), { ...r(id), ...fields });
    return {
      async beginTransaction() {},
      async commit() {
        state.redemptions.push(...pending);
        for (const [id, row] of changes) state.rides.set(id, row);
        clear();
      },
      async rollback() {
        clear();
      },
      release() {},
      async query(sql, args = []) {
        state.calls.push({ sql, args });
        if (sql.startsWith("SELECT * FROM promotions WHERE audience"))
          return [
            state.offers
              .filter(
                (o) =>
                  o.audience === args[0] &&
                  o.status === "active" &&
                  o.starts_at_ms <= args[1] &&
                  o.ends_at_ms > args[2],
              )
              .map((o) => ({ ...o })),
          ];
        if (sql.startsWith("SELECT * FROM promotions WHERE id")) {
          await lock(Number(args[0]));
          return [[state.offers.find((o) => o.id === Number(args[0]))]].map(
            (rows) => rows.filter(Boolean),
          );
        }
        if (sql.includes("AS used") || sql.includes("AS pending")) {
          const rows = records().filter(
            (p) =>
              p.offer_id === Number(args[0]) &&
              p.actor_user_id === Number(args[1]) &&
              p.state !== "released" &&
              r(p.ride_id),
          );
          if (sql.includes("AS used"))
            return [
              [
                {
                  used: rows.filter(
                    (p) =>
                      r(p.ride_id).Ride_Status === "Completed" ||
                      active.has(r(p.ride_id).Ride_Status),
                  ).length,
                },
              ],
            ];
          return [
            [
              {
                pending: rows.filter(
                  (p) =>
                    p.state === "reserved" &&
                    active.has(r(p.ride_id).Ride_Status),
                ).length,
              },
            ],
          ];
        }
        if (sql.includes("AS completed"))
          return [
            [
              {
                completed: [...state.rides.values()].filter(
                  (row) =>
                    row.Ride_Status === "Completed" &&
                    (sql.includes("JOIN drivers")
                      ? row.DriverUser === args[0]
                      : row.User_ID_Fk === args[0]),
                ).length,
              },
            ],
          ];
        if (sql.startsWith("INSERT INTO ride_promotions")) {
          const [
            ride_id,
            offer_id,
            audience,
            actor_user_id,
            offer_name,
            discount_percent,
            max_discount,
            discount_base_limit,
            original_fare,
            benefit_amount,
          ] = args;
          assert(
            !records().some(
              (p) => p.ride_id === ride_id && p.audience === audience,
            ),
            "duplicate reservation",
          );
          pending.push({
            id: state.nextId++,
            ride_id,
            offer_id,
            audience,
            actor_user_id,
            offer_name,
            discount_percent,
            max_discount,
            discount_base_limit,
            original_fare,
            benefit_amount,
            state: "reserved",
          });
          return [{ insertId: state.nextId - 1 }];
        }
        if (sql.startsWith("UPDATE ride_history SET Rider_Discount")) {
          update(args.at(-1), {
            Rider_Discount: args[0],
            Customer_Payable: args[1],
            ...(args.length === 4 ? { Rider_Offer_ID: args[2] } : {}),
          });
          return [{}];
        }
        if (sql.startsWith("UPDATE ride_history SET Driver_Commission")) {
          update(args[1], {
            Driver_Commission_Waived: 1,
            Driver_Offer_ID: args[0],
          });
          return [{}];
        }
        if (sql.startsWith("SELECT * FROM ride_promotions"))
          return [
            records().filter(
              (p) =>
                p.ride_id === args[0] &&
                p.audience === "rider" &&
                p.state === "reserved",
            ),
          ];
        if (sql.startsWith("UPDATE ride_promotions SET original_fare")) {
          for (const p of records())
            if (p.ride_id === args[2] && p.audience === "rider") {
              p.original_fare = args[0];
              p.benefit_amount = args[1];
            }
          return [{}];
        }
        if (sql.startsWith("UPDATE ride_promotions SET state")) {
          for (const p of records())
            if (p.ride_id === args[0] && p.state === "reserved")
              p.state = "consumed";
          return [{}];
        }
        if (sql.startsWith("SELECT p.offer_id")) {
          const found = records().find(
            (p) =>
              p.actor_user_id === args[0] &&
              p.audience === "driver" &&
              p.state === "reserved" &&
              r(p.ride_id)?.Driver_ID_Fk === args[1] &&
              ["Accepted", "Arrived", "Started", "Ongoing"].includes(
                r(p.ride_id).Ride_Status,
              ) &&
              r(p.ride_id).Driver_Commission_Waived === 1,
          );
          return [
            found
              ? [
                  {
                    ...found,
                    ends_at_ms: state.offers.find(
                      (o) => o.id === found.offer_id,
                    ).ends_at_ms,
                  },
                ]
              : [],
          ];
        }
        if (sql.includes("FROM vehicle_fare_rate"))
          return [
            [
              {
                Base_Fare: 500,
                Per_Km_Rate: 0,
                Per_Minute_Rate: 0,
                Fee_Percentage: 0,
                Night_Charge_Percent: 0,
                Peak_Hours_Percent: 0,
                Maximum_Distance: 100,
                Minimum_Distance: 1,
                rides_over_limit_count: 300,
              },
            ],
          ];
        if (sql.includes("FROM fare_policy"))
          return [
            [
              {
                policy_json: JSON.stringify(
                  require("../services/farePolicy").DEFAULT_POLICY,
                ),
              },
            ],
          ];
        throw new Error(`Unexpected offer SQL: ${sql}`);
      },
    };
  }
  async function reserve(id, audience = "rider", userId = 42, extra = {}) {
    const c = connection();
    await c.beginTransaction();
    try {
      const result = await offers.reserve(c, {
        rideId: id,
        userId,
        audience,
        gross: 500,
        normalFee: 15,
        verifiedLimit: 500,
        ...extra,
      });
      await c.commit();
      return result;
    } catch (e) {
      await c.rollback();
      throw e;
    }
  }
  return { state, ride, connection, reserve };
}
test("next-N quotas are per account and only completed or active reservations count", async () => {
  const f = fixture();
  f.ride(1);
  await f.reserve(1);
  assert.equal(f.state.rides.get(1).Customer_Payable, 350);
  assert.equal(
    (await offers.usage(f.connection(), f.state.offers[0], 42)).remaining,
    2,
  );
  f.state.rides.get(1).Ride_Status = "Cancelled";
  assert.equal(
    (await offers.usage(f.connection(), f.state.offers[0], 42)).remaining,
    3,
  );
  f.ride(2);
  await f.reserve(2);
  f.state.rides.get(2).Ride_Status = "Completed";
  assert.equal(
    (await offers.usage(f.connection(), f.state.offers[0], 42)).remaining,
    2,
  );
  assert.equal(
    (await offers.usage(f.connection(), f.state.offers[0], 43)).remaining,
    3,
  );
});
test("pause/resume and editing a campaign preserve usage; a new campaign receives a new quota", async () => {
  const f = fixture([campaign(1, "driver", { ride_limit: 1 })]);
  f.ride(1);
  await f.reserve(1, "driver");
  f.state.rides.get(1).Ride_Status = "Completed";
  assert.equal(
    await offers.driverBenefit(f.connection(), { id: 100, User_ID_FK: 42 }, 0),
    null,
  );
  f.state.offers[0].status = "paused";
  f.state.offers[0].status = "active";
  f.state.offers[0].name = "Renamed";
  assert.equal(
    (await offers.usage(f.connection(), f.state.offers[0], 42)).remaining,
    0,
  );
  assert.equal(
    (await offers.driverBenefit(f.connection(), { id: 101, User_ID_FK: 43 }, 0))
      .remaining_rides,
    1,
  );
  f.state.offers[0].status = "closed";
  f.state.offers.push(campaign(2, "driver", { ride_limit: 10 }));
  assert.equal(
    (await offers.driverBenefit(f.connection(), { id: 100, User_ID_FK: 42 }, 0))
      .remaining_rides,
    10,
  );
  assert.equal(
    (await offers.usage(f.connection(), f.state.offers[0], 42)).used,
    1,
  );
});
test("two simultaneous requests cannot reserve the last discounted ride twice", async () => {
  const f = fixture([campaign(1, "rider", { ride_limit: 1 })]);
  f.ride(1);
  f.ride(2);
  const results = await Promise.allSettled([
    f.reserve(1, "rider", 42, {
      expected: { offer_id: 1, customer_payable: 350 },
    }),
    f.reserve(2, "rider", 42, {
      expected: { offer_id: 1, customer_payable: 350 },
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.filter((r) => r.status === "rejected" && r.reason.status === 409)
      .length,
    1,
  );
  assert.equal(f.state.redemptions.length, 1);
});
test("lifetime first-N offers do not reset when a new campaign is created", async () => {
  const f = fixture([
    campaign(1, "rider", { eligibility: "first_rides", ride_limit: 3 }),
  ]);
  for (let id = 1; id <= 3; id++) f.ride(id).Ride_Status = "Completed";
  f.ride(4);
  assert.equal((await f.reserve(4)).offer_id, null);
  f.state.offers[0].status = "closed";
  f.state.offers.push(
    campaign(2, "rider", { eligibility: "first_rides", ride_limit: 3 }),
  );
  assert.equal((await f.reserve(4)).offer_id, null);
  f.state.offers[1].eligibility = "next_rides";
  assert.equal((await f.reserve(4)).offer_id, 2);
});
test("overlapping offers select one largest capped benefit without stacking", async () => {
  const f = fixture([
    campaign(1, "rider", { discount_percent: 50, max_discount: 50 }),
    campaign(2, "rider", { discount_percent: 30 }),
    campaign(3, "rider", { discount_percent: 90, status: "paused" }),
  ]);
  f.ride(1);
  const q = await f.reserve(1);
  assert.equal(q.offer_id, 2);
  assert.equal(q.discount_amount, 150);
  assert.equal(f.state.redemptions.length, 1);
});
test("unverified client-increased fare cannot inflate the subsidy; repricing preserves the snapshot after closing", async () => {
  const f = fixture();
  f.ride(1);
  const q = await f.reserve(1, "rider", 42, {
    gross: 1000,
    verifiedLimit: 500,
  });
  assert.equal(q.discount_amount, 150);
  assert.equal(q.customer_payable, 850);
  f.state.offers[0].status = "closed";
  f.state.offers[0].discount_percent = 1;
  const c = f.connection();
  await c.beginTransaction();
  const repriced = await offers.updateRiderFare(c, f.state.rides.get(1), 1500);
  await c.commit();
  assert.equal(repriced.discount_amount, 150);
  assert.equal(repriced.customer_payable, 1350);
});
test("expiry and scheduled start are enforced, including at the exact end boundary", async () => {
  for (const change of [
    { ends_at_ms: Date.now() },
    { starts_at_ms: Date.now() + 3600000 },
    { status: "paused" },
    { status: "closed" },
  ]) {
    const f = fixture([campaign(1, "rider", change)]);
    f.ride(1);
    assert.equal((await f.reserve(1)).offer_id, null);
  }
});
test("a reserved final driver ride remains free after the campaign closes, then requires top-up", async () => {
  const f = fixture([campaign(1, "driver", { ride_limit: 1 })]);
  f.ride(1);
  await f.reserve(1, "driver");
  f.state.rides.get(1).Ride_Status = "Started";
  f.state.offers[0].status = "closed";
  const current = await offers.driverBenefit(
    f.connection(),
    { id: 100, User_ID_FK: 42 },
    0,
  );
  assert.equal(current.current_ride, true);
  assert.equal(current.remaining_rides, 0);
  const c = f.connection();
  await offers.finish(c, f.state.rides.get(1));
  assert.equal(
    await offers.driverBenefit(f.connection(), { id: 100, User_ID_FK: 42 }, 0),
    null,
  );
  assert.equal(
    await offers.driverBenefit(f.connection(), { id: 100, User_ID_FK: 42 }, -1),
    null,
  );
});
test("offer rules reject role injections, invalid discounts, invalid dates and capped driver waivers", () => {
  const body = { ...campaign(), request_key: "a".repeat(36) };
  delete body.id;
  assert.equal(validate(body).discount_percent, 30);
  for (const changes of [
    { audience: "admin" },
    { discount_percent: 101 },
    { discount_percent: -1 },
    { ride_limit: 0 },
    { ends_at_ms: body.starts_at_ms },
    { starts_at_ms: "bad" },
    { max_discount: -1 },
    { actor_id: 1 },
    { audience: "driver", discount_percent: 30 },
    { audience: "driver", discount_percent: 100, max_discount: 10 },
  ])
    assert.throws(() => validate({ ...body, ...changes }), { status: 400 });
});
test("disabled rollout does not silently discard a rider-confirmed discount", async () => {
  const f = fixture();
  process.env.OFFERS_ENABLED = "false";
  try {
    f.ride(1);
    await assert.rejects(
      f.reserve(1, "rider", 42, {
        expected: { offer_id: 1, customer_payable: 350 },
      }),
      { status: 409 },
    );
    assert.equal(f.state.redemptions.length, 0);
  } finally {
    process.env.OFFERS_ENABLED = "true";
  }
});

test("ten free rides used in one day blocks only that driver; other drivers keep their own remaining quota", async () => {
  const f = fixture([campaign(1, "driver", { ride_limit: 10 })]);
  let id = 1;
  for (const [user, count] of [
    [42, 10],
    [43, 6],
  ])
    for (let i = 0; i < count; i++) {
      const r = f.ride(id, user, user + 100);
      r.DriverUser = user;
      r.Ride_Status = "Completed";
      f.state.redemptions.push({
        ride_id: id,
        offer_id: 1,
        actor_user_id: user,
        audience: "driver",
        state: "consumed",
      });
      id++;
    }
  const { getVehicleMinWalletLimit } = require("../utils/driverHelper");
  assert.equal(
    await getVehicleMinWalletLimit(f.connection(), "Mini", {
      driver: { id: 142, User_ID_FK: 42 },
      balance: 0,
    }),
    300,
  );
  assert.equal(
    (await offers.driverBenefit(f.connection(), { id: 143, User_ID_FK: 43 }, 0))
      .remaining_rides,
    4,
  );
  assert.equal(
    (await offers.driverBenefit(f.connection(), { id: 144, User_ID_FK: 44 }, 0))
      .remaining_rides,
    10,
  );
  assert.equal(
    await getVehicleMinWalletLimit(f.connection(), "Mini", {
      driver: { id: 143, User_ID_FK: 43 },
      balance: 0,
    }),
    0,
  );
  assert.equal(
    await getVehicleMinWalletLimit(f.connection(), "Mini", {
      driver: { id: 143, User_ID_FK: 43 },
      balance: -1,
    }),
    300,
  );
});
test("public rider quote verifies the route server-side and ignores a client-supplied discount ceiling", async (t) => {
  const axios = require("axios"),
    previous = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = "test-only-key";
  t.after(() => {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previous;
  });
  t.mock.method(axios, "get", async () => ({
    data: {
      status: "OK",
      routes: [
        { legs: [{ distance: { value: 2000 }, duration: { value: 600 } }] },
      ],
    },
  }));
  const f = fixture();
  const quote = await offers.riderQuote(f.connection(), 42, 9000, {
    pickup: { latitude: 24.86, longitude: 67 },
    destination: { latitude: 24.87, longitude: 67.01 },
    vehicle_type: "Mini",
    discount_base_limit: 9000,
    discount_percent: 100,
  });
  assert.equal(quote.discount_amount, 150);
  assert.equal(quote.customer_payable, 8850);
  assert.equal(quote.discount_base_limit, 500);
  assert.equal(f.state.redemptions.length, 0);
});
test("unverifiable routes fail closed instead of granting an unchecked subsidy", async (t) => {
  const axios = require("axios"),
    previous = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = "test-only-key";
  t.after(() => {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previous;
  });
  t.mock.method(axios, "get", async () => ({
    data: { status: "ZERO_RESULTS" },
  }));
  const f = fixture();
  await assert.rejects(
    offers.riderQuote(f.connection(), 42, 500, {
      pickup: { latitude: 24, longitude: 67 },
      destination: { latitude: 25, longitude: 68 },
      vehicle_type: "Mini",
    }),
    { status: 503 },
  );
  assert.equal(f.state.redemptions.length, 0);
});

test("offer top-up bypass fails closed when the driver balance cannot be read", async () => {
  const { getDriverWalletBalance } = require("../utils/driverHelper");
  await assert.rejects(
    getDriverWalletBalance(
      {
        query: async () => {
          throw new Error("Ledger unavailable");
        },
      },
      100,
    ),
    /Ledger unavailable/,
  );
});
