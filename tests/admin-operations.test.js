const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateCityFare } = require("../services/cityToCityPricing");
const {
  createAdminCityToCitySettings,
  validateChanges,
  version,
} = require("../services/adminCityToCitySettings");
const {
  createAdminFranchiseMembers,
  validateMember,
  scope,
} = require("../services/adminFranchiseMembers");
const base = {
  id: 1,
  code: "shared",
  name: "Shared",
  fare_model: "distance",
  base_fare: 100,
  per_km_rate: 10,
  per_minute_rate: 2,
  minimum_fare: 100,
  maximum_fare: null,
  fixed_fare: null,
  included_distance_km: 1,
  included_duration_minutes: 0,
  included_weight_kg: 0,
  extra_per_kg_rate: 5,
  booking_fee: 20,
  tax_percent: 10,
  commission_percent: 10,
  commission_fixed: 5,
  rounding_increment: 10,
  is_pricing_enabled: 1,
  is_active: 1,
  min_passengers: 1,
  max_passengers: 4,
};
test("shared, private and parcel calculations preserve unit rounding, fees, tax and commission", () => {
  const input = {
    distance_km: 11,
    duration_minutes: 5,
    passenger_count: 3,
    parcel_weight_kg: 2,
  };
  const shared = calculateCityFare(base, input, "shared");
  assert.equal(shared.unit_fare, 210);
  assert.equal(shared.suggested_fare, 715);
  assert.equal(shared.platform_commission, 76.5);
  assert.equal(shared.driver_earnings, 638.5);
  assert.equal(calculateCityFare(base, input, "private").suggested_fare, 253);
  assert.equal(calculateCityFare(base, input, "parcel").suggested_fare, 264);
  assert.equal(
    calculateCityFare({ ...base, is_pricing_enabled: 0 }, input, "shared")
      .suggested_fare,
    null,
  );
  assert.equal(
    calculateCityFare(
      { ...base, fare_model: "fixed", fixed_fare: 250, maximum_fare: 240 },
      input,
      "private",
    ).suggested_fare,
    286,
  );
});
test("tariff validation rejects protected identities, invalid money and inconsistent limits", () => {
  for (const changes of [
    { code: "private" },
    { updated_by: 2 },
    { tax_percent: 101 },
    { per_km_rate: -1 },
    { base_fare: true },
    { base_fare: " " },
    { base_fare: "2.001" },
    { is_active: "yes" },
    { fare_model: "fixed" },
    { maximum_fare: 10 },
    { max_passengers: 0 },
    { request_expiry_minutes: 0 },
    { min_passengers: null },
    { name: "x".repeat(101) },
  ])
    assert.throws(() => validateChanges(changes, base), { status: 400 });
  assert.deepEqual(
    validateChanges({ per_km_rate: "25.50", maximum_fare: "" }, base),
    { per_km_rate: 25.5, maximum_fare: null },
  );
});
function tariffFixture({ stale = false, permission = true } = {}) {
  const state = { commits: 0, rollbacks: 0, queries: [] };
  let row = { ...base };
  const conn = {
    async beginTransaction() {},
    async commit() {
      state.commits++;
    },
    async rollback() {
      state.rollbacks++;
    },
    release() {},
    async query(sql, args) {
      state.queries.push({ sql, args });
      if (sql.includes("FROM employee WHERE"))
        return [
          [
            {
              emp_id: 7,
              account_type: permission ? "superadmin" : "employee",
              is_active: 1,
              is_deleted: 0,
            },
          ],
        ];
      if (sql.includes("SELECT DISTINCT f.function_code")) return [[]];
      if (sql.startsWith("SELECT * FROM city_to_city_services")) return [[row]];
      if (sql.startsWith("UPDATE city_to_city_services")) {
        row = { ...row, per_km_rate: 30 };
        return [{}];
      }
      throw new Error(sql);
    },
  };
  return {
    state,
    service: createAdminCityToCitySettings({ getConnection: async () => conn }),
    version: stale ? "stale" : version(row),
  };
}
test("tariff writes recheck access, lock current version and record the authenticated editor", async () => {
  const f = tariffFixture();
  await f.service.save("services", 1, 7, {
    version: f.version,
    changes: { per_km_rate: 30 },
  });
  assert.equal(f.state.commits, 1);
  const update = f.state.queries.find((q) => q.sql.startsWith("UPDATE"));
  assert.deepEqual(update.args, [30, 7, 1]);
  assert.match(
    f.state.queries.find((q) => q.sql.startsWith("SELECT *")).sql,
    /FOR UPDATE/,
  );
  const stale = tariffFixture({ stale: true });
  await assert.rejects(
    stale.service.save("services", 1, 7, {
      version: stale.version,
      changes: { per_km_rate: 30 },
    }),
    { status: 409 },
  );
  assert.equal(stale.state.rollbacks, 1);
  const denied = tariffFixture({ permission: false });
  await assert.rejects(
    denied.service.save("services", 1, 7, {
      version: denied.version,
      changes: { per_km_rate: 30 },
    }),
    { status: 403 },
  );
  assert.equal(
    denied.state.queries.some((q) => q.sql.startsWith("UPDATE")),
    false,
  );
});
test("calculator selects the same directional route precedence as customer quotes and performs no writes", async () => {
  const queries = [];
  const pool = {
    async query(sql, args) {
      queries.push({ sql, args });
      assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\b/);
      if (sql.includes("city_to_city_services")) return [[base]];
      return [
        [
          {
            ...base,
            id: 9,
            name: "Karachi to Hyderabad",
            fare_model: "fixed",
            fixed_fare: 500,
          },
        ],
      ];
    },
  };
  const result = await createAdminCityToCitySettings(pool).preview({
    service_id: 1,
    origin_city_id: 1,
    destination_city_id: 2,
    distance_km: 100,
    duration_minutes: 90,
    passenger_count: 2,
  });
  assert.equal(result.source, "Route tariff");
  assert.equal(result.suggested_fare, 1122);
  assert.match(queries[1].sql, /vehicle_type IS NULL.*priority DESC,id DESC/);
  assert.deepEqual(queries[1].args, [1, 1, 2]);
  await assert.rejects(
    createAdminCityToCitySettings(pool).preview({
      service_id: 1,
      origin_city_id: 1,
      destination_city_id: 1,
    }),
    { status: 400 },
  );
});
const memberBody = {
  franchise_id: 5,
  kind: "driver",
  idempotency_key: "01234567-89ab-4def-8123-0123456789ab",
  profile: {
    full_name: "Test Driver",
    phone: "+923001234567",
    city: "Karachi",
    cnic: "4210112345671",
    vehicle_type: "Car",
    vehicle_number: "ABC-123",
    address: "Test address",
  },
};
test("member validation normalizes Pakistani phones and forbids role, balance or franchise injection in profiles", () => {
  assert.equal(validateMember(memberBody).phone, "03001234567");
  for (const profile of [
    { ...memberBody.profile, Role: "admin" },
    { ...memberBody.profile, Franchiser_ID_FK: 9 },
    { ...memberBody.profile, phone: "1234" },
  ])
    assert.throws(() => validateMember({ ...memberBody, profile }), {
      status: 400,
    });
  assert.throws(() => validateMember({ ...memberBody, kind: "admin" }), {
    status: 400,
  });
});
function memberFixture({
  superadmin = false,
  missingScope = false,
  duplicate = false,
  retry = false,
  failInsert = false,
  inactive = false,
} = {}) {
  const state = { queries: [], commits: 0, rollbacks: 0, released: 0 };
  const conn = {
    async beginTransaction() {},
    async commit() {
      state.commits++;
    },
    async rollback() {
      state.rollbacks++;
    },
    release() {
      state.released++;
    },
    async query(sql, args = []) {
      state.queries.push({ sql, args });
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.includes("FROM employee WHERE"))
        return [
          [
            {
              emp_id: 7,
              account_type: superadmin ? "superadmin" : "employee",
              is_active: 1,
              is_deleted: 0,
            },
          ],
        ];
      if (sql.includes("SELECT DISTINCT"))
        return [[{ function_code: "franchise_members" }]];
      if (sql.includes("FROM employee_franchise_access"))
        return [missingScope ? [] : [{ franchise_id: 5 }]];
      if (sql.includes("FROM franchiser"))
        return [[{ id: 5, status: inactive ? "suspended" : "active" }]];
      if (sql.includes("FROM admin_franchise_member_requests"))
        return [
          retry ? [{ actor_id: 8, franchise_id: 5, fingerprint: "wrong" }] : [],
        ];
      if (sql.includes("FROM users") || sql.includes("FROM drivers"))
        return [duplicate ? [{ id: 12 }] : []];
      if (sql.startsWith("INSERT INTO users")) return [{ insertId: 21 }];
      if (sql.startsWith("INSERT INTO drivers")) {
        if (failInsert) throw new Error("test insert failure");
        return [{ insertId: 31 }];
      }
      return [{}];
    },
  };
  return {
    state,
    conn,
    service: createAdminFranchiseMembers({ getConnection: async () => conn }),
  };
}
test("franchise staff are limited to their server assignment, including forged franchise IDs", async () => {
  const f = memberFixture();
  assert.equal(await scope(f.conn, 7, 5), 5);
  await assert.rejects(scope(f.conn, 7, 6), { status: 403 });
  await assert.rejects(
    scope(memberFixture({ missingScope: true }).conn, 7, 5),
    { status: 403 },
  );
  await assert.rejects(
    f.service.create(7, { ...memberBody, franchise_id: 6 }),
    { status: 403 },
  );
  assert.equal(
    f.state.queries.some((q) => q.sql.startsWith("INSERT")),
    false,
  );
});
test("franchise creates driver and linked mobile user atomically under its own ID with pending approval", async () => {
  const f = memberFixture();
  const result = await f.service.create(7, memberBody);
  assert.equal(result.id, 31);
  assert.equal(result.status, "pending");
  assert.equal(f.state.commits, 1);
  assert.equal(f.state.released, 1);
  const user = f.state.queries.find((q) =>
    q.sql.startsWith("INSERT INTO users"),
  );
  assert.equal(user.args[5], 5);
  assert.equal(user.args[6], "Karachi");
  assert.equal(user.args[7], "Test address");
  const driver = f.state.queries.find((q) =>
    q.sql.startsWith("INSERT INTO drivers"),
  );
  assert.match(driver.sql, /'pending'/);
  assert.equal(driver.args[0], 21);
  assert.equal(driver.args[1], 5);
  assert.ok(
    f.state.queries.some((q) =>
      q.sql.startsWith("INSERT INTO admin_franchise_member_requests"),
    ),
  );
  assert.ok(f.state.queries.some((q) => q.sql.includes("RELEASE_LOCK")));
  for (const { sql, args } of f.state.queries)
    assert.equal((sql.match(/\?/g) || []).length, args.length);
});
test("duplicate accounts, reused request keys and inactive franchises never create users", async () => {
  for (const config of [
    { duplicate: true },
    { retry: true },
    { inactive: true },
  ]) {
    const f = memberFixture(config);
    await assert.rejects(f.service.create(7, memberBody), { status: 409 });
    assert.equal(
      f.state.queries.some((q) => q.sql.startsWith("INSERT")),
      false,
    );
    assert.equal(f.state.rollbacks, 1);
  }
});
test("failed driver creation rolls back its mobile user and releases the phone lock", async () => {
  const f = memberFixture({ failInsert: true });
  await assert.rejects(f.service.create(7, memberBody), /test insert failure/);
  assert.equal(f.state.rollbacks, 1);
  assert.equal(f.state.commits, 0);
  assert.equal(f.state.released, 1);
  assert.ok(f.state.queries.some((q) => q.sql.includes("RELEASE_LOCK")));
});
test("rider creation preserves city and address without creating a driver", async () => {
  const f = memberFixture();
  const result = await f.service.create(7, {
    ...memberBody,
    kind: "rider",
    profile: {
      full_name: "Test Rider",
      phone: "03001234567",
      city: "Karachi",
      address: "Test address",
    },
  });
  assert.equal(result.id, 21);
  assert.equal(result.kind, "rider");
  assert.equal(
    f.state.queries.some((q) => q.sql.startsWith("INSERT INTO drivers")),
    false,
  );
});

test("rider edits protect mobile identity, reject stale versions and preserve roles", async () => {
  const {
    createAdminRiderProfiles,
  } = require("../services/adminRiderProfiles");
  let row = {
    id: 3,
    full_name: "Rider",
    phone: "03001234567",
    email: null,
    cnic: null,
    address: "Street",
    city: "Karachi",
  };
  const queries = [];
  let commits = 0,
    rollbacks = 0;
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {
      commits++;
    },
    rollback: async () => {
      rollbacks++;
    },
    release() {},
    async query(sql, args) {
      queries.push({ sql, args });
      if (sql.includes("FROM employee WHERE"))
        return [
          [
            {
              emp_id: 7,
              account_type: "superadmin",
              is_active: 1,
              is_deleted: 0,
            },
          ],
        ];
      if (sql.startsWith("SELECT User_ID_Pk AS id")) return [[{ ...row }]];
      if (sql.startsWith("UPDATE users")) {
        row = { ...row, city: args[0] };
        return [{}];
      }
      throw new Error(sql);
    },
  };
  const service = createAdminRiderProfiles({
    query: conn.query.bind(conn),
    getConnection: async () => conn,
  });
  const profile = await service.detail(3);
  await service.update(3, 7, {
    version: profile.version,
    changes: { city: "Lahore" },
  });
  assert.equal(commits, 1);
  const update = queries.find((q) => q.sql.startsWith("UPDATE"));
  assert.equal(update.sql, "UPDATE users SET City=? WHERE User_ID_Pk=?");
  assert.deepEqual(update.args, ["Lahore", 3]);
  await assert.rejects(
    service.update(3, 7, {
      version: profile.version,
      changes: { city: "Islamabad" },
    }),
    { status: 409 },
  );
  assert.equal(rollbacks, 1);
  for (const changes of [
    { phone: "03007654321" },
    { Role: "admin" },
    { Franchiser_ID_FK: 99 },
    { full_name: "x".repeat(51) },
    { address: "a".repeat(101) },
  ])
    await assert.rejects(
      service.update(3, 7, { version: profile.version, changes }),
      { status: 400 },
    );
});
test("franchise business edits use the detail version and reject protected IDs or invalid fees", async () => {
  const {
    createAdminFranchisesService,
  } = require("../services/adminFranchises");
  let row = {
    id: 5,
    company_name: "Central",
    contact_person: "Owner",
    city: "Karachi",
    profile_complete: 1,
    franchise_fee: "1000.00",
    driver_count: 0,
    rider_count: 0,
    updated_at: 10000,
  };
  const queries = [];
  let commits = 0;
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {
      commits++;
    },
    rollback: async () => {},
    release() {},
    async query(sql, args) {
      queries.push({ sql, args });
      if (sql.includes("FROM employee WHERE"))
        return [
          [
            {
              emp_id: 7,
              account_type: "superadmin",
              is_active: 1,
              is_deleted: 0,
            },
          ],
        ];
      if (sql.startsWith("SELECT")) return [[row]];
      if (sql.startsWith("UPDATE franchiser")) {
        row = { ...row, city: args[0], updated_at: 20000 };
        return [{}];
      }
      throw new Error(sql);
    },
  };
  const service = createAdminFranchisesService({
    getConnection: async () => conn,
  });
  const profile = await service.get(5);
  await service.update(5, 7, {
    version: profile.version,
    changes: { city: "Lahore" },
  });
  assert.equal(commits, 1);
  assert.deepEqual(queries.find((q) => q.sql.startsWith("UPDATE")).args, [
    "Lahore",
    5,
  ]);
  await assert.rejects(
    service.update(5, 7, {
      version: profile.version,
      changes: { city: "Islamabad" },
    }),
    { status: 409 },
  );
  for (const changes of [
    { id: 6 },
    { franchise_fee: -1 },
    { royalty_fee: 101 },
    { number_of_locations: 1.5 },
    { contact_person: "a".repeat(51) },
    { status: "deleted" },
  ])
    await assert.rejects(
      service.update(5, 7, { version: profile.version, changes }),
      { status: 400 },
    );
});

test("a route can remove a default maximum fare and calculator respects the configured passenger minimum", async () => {
  const service = {
    ...base,
    minimum_fare: 0,
    maximum_fare: 200,
    min_passengers: 2,
  };
  const pool = {
    async query(sql) {
      return sql.includes("city_to_city_services")
        ? [[service]]
        : [[{ ...base, id: 9, maximum_fare: null, base_fare: 500 }]];
    },
  };
  const api = createAdminCityToCitySettings(pool),
    input = {
      service_id: 1,
      origin_city_id: 1,
      destination_city_id: 2,
      distance_km: 0,
      duration_minutes: 0,
      passenger_count: 2,
    };
  const result = await api.preview(input);
  assert.equal(result.unit_fare, 500);
  await assert.rejects(api.preview({ ...input, passenger_count: 1 }), {
    status: 400,
  });
});

test('service minimum top-up accepts money and is excluded from route tariffs',async()=>{
 assert.deepEqual(validateChanges({minimum_topup_amount:'750.50'},base),{minimum_topup_amount:750.5});
 assert.deepEqual(validateChanges({minimum_topup_amount:0},base),{minimum_topup_amount:0});
 for(const amount of [-1,'',null,true,'1.001',100000000])assert.throws(()=>validateChanges({minimum_topup_amount:amount},base),{status:400});
 assert.throws(()=>validateChanges({minimum_topup_amount:100},base,true),{status:400});
 const f=tariffFixture();await f.service.save('services',1,7,{version:f.version,changes:{minimum_topup_amount:750}});
 const q=f.state.queries.find(q=>q.sql.startsWith('UPDATE'));
 assert.match(q.sql,/UPDATE city_to_city_services SET minimum_topup_amount=\?/);assert.deepEqual(q.args,[750,7,1]);
 assert.equal(f.state.commits,1);
});

test('minimum required balance is validated as service money and excluded from route overrides',()=>{
 assert.deepEqual(validateChanges({minimum_required_balance:'500.25'},base),{minimum_required_balance:500.25});
 for(const value of [-1,'',true,null,'1.001'])assert.throws(()=>validateChanges({minimum_required_balance:value},base),{status:400});
 assert.throws(()=>validateChanges({minimum_required_balance:500},base,true),{status:400});
});
