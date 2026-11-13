const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  createNormalDriverEnrollment,
  sameVehicle,
} = require("../services/normalDriverEnrollment");
const body = {
  Name: "Ali",
  FatherName: "Father",
  Cnic: "4210112345671",
  DOB: "1990-01-01",
  Address: "Karachi address",
  City: "Karachi",
  Mobile: "03001234567",
  Vehicle_Type: "Ride AC",
  Vehicle_Model: "Corolla",
  Vehicle_Number: "ABC-123",
  Vehicle_Color: "White",
  Password: "signup-password",
};
function fixture({
  existing = true,
  missing,
  failInsert = false,
  failCode = false,
  city = true,
} = {}) {
  const state = {
    users: existing
      ? [
          {
            User_ID_Pk: 42,
            User_Name: "Ali",
            Mobile: "03001234567",
            Email: "ali@example.com",
            Password: "$2b$existing-personal-hash",
            Role: "rider",
            AccountDeleted: 0,
          },
        ]
      : [],
    drivers: [],
    queries: [],
    commits: 0,
    rollbacks: 0,
  };
  let queue = Promise.resolve();
  const profile = {
    id: 5,
    full_name: "Ali",
    father_name: "Father",
    cnic: "4210112345671",
    dob: "1990-01-01",
    address: "Karachi address",
    city: "Karachi",
  };
  const vehicle = {
    id: 9,
    vehicle_type: "Car",
    model: "Corolla",
    registration_number: "ABC-123",
    color: "White",
  };
  const docs = [
    "photo",
    "cnic_front",
    "cnic_back",
    "license",
    "vehicle_registration",
  ]
    .filter((t) => t !== missing)
    .map((document_type, id) => ({
      id: id + 1,
      document_type,
      vehicle_id: document_type === "vehicle_registration" ? 9 : null,
      file_key: `admin-private:${document_type}.jpg`,
    }));
  async function query(sql, args = []) {
    state.queries.push({ sql, args });
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
    if (sql.startsWith("SELECT User_ID_Pk,User_Name"))
      return [state.users.filter((u) => u.User_ID_Pk === args[0])];
    if (sql.startsWith("SELECT User_ID_Pk FROM users"))
      return [state.users.filter((u) => args.includes(u.Mobile))];
    if (sql.startsWith("SELECT d.id,d.full_name"))
      return [city ? [profile] : []];
    if (sql.startsWith("SELECT id,vehicle_type")) return [[vehicle]];
    if (sql.startsWith("SELECT document_type,vehicle_id")) return [docs];
    if (sql.startsWith("SELECT id,User_ID_FK,status"))
      return [
        state.drivers.filter(
          (d) => d.User_ID_FK === args[0] || args.slice(1).includes(d.phone)
        ),
      ];
    if (sql.startsWith("SELECT Vehicle_Type FROM"))
      return [
        ["Ride AC", "Bike", "Car"].includes(args[0])
          ? [{ Vehicle_Type: args[0] }]
          : [],
      ];
    if (sql.startsWith("INSERT INTO users")) {
      const id = 42;
      state.users.push({
        User_ID_Pk: id,
        User_Name: args[0],
        Email: args[1],
        Password: args[2],
        Mobile: args[3],
        Role: args[4],
      });
      return [{ insertId: id }];
    }
    if (sql.startsWith("INSERT INTO drivers")) {
      if (failInsert) throw new Error("DRIVER_FAILED");
      const keys = sql.match(/\((.*?)\)/)[1].split(",");
      const row = { id: 25, status: "pending" };
      keys.slice(0, -2).forEach((key, i) => (row[key] = args[i]));
      state.drivers.push(row);
      return [{ insertId: 25 }];
    }
    if (sql.startsWith("UPDATE drivers SET driver_code")) {
      if (failCode) throw new Error("CODE_FAILED");
      state.drivers.find((d) => d.id === args[1]).driver_code = args[0];
      return [{}];
    }
    throw new Error(sql);
  }
  const pool = {
    getConnection: async () => {
      let unlock, snapshot;
      return {
        query,
        async beginTransaction() {
          const before = queue;
          queue = new Promise((r) => {
            unlock = r;
          });
          await before;
          snapshot = structuredClone({
            users: state.users,
            drivers: state.drivers,
          });
        },
        async commit() {
          state.commits++;
          unlock?.();
        },
        async rollback() {
          if (snapshot) {
            state.users = snapshot.users;
            state.drivers = snapshot.drivers;
          }
          state.rollbacks++;
          unlock?.();
        },
        release() {},
      };
    },
  };
  return {
    state,
    service: createNormalDriverEnrollment(pool),
    profile,
    vehicle,
  };
}
test("City-to-City owner reuses personal and same-car documents, keeps one user and a separate pending driver", async () => {
  const f = fixture();
  const r = await f.service.enroll(42, {
    ...body,
    user_id: 999,
    application_status: "approved",
    Photo: "untrusted",
  });
  assert.equal(r.user_id, 42);
  assert.equal(r.driver_code, "GRD-1025");
  assert.equal(r.status, "pending");
  assert.equal(r.reused_documents.length, 5);
  assert.equal(f.state.users.length, 1);
  assert.equal(f.state.drivers[0].User_ID_FK, 42);
  assert.equal(f.state.drivers[0].password, "$2b$existing-personal-hash");
  assert.equal(
    f.state.drivers[0].cnic_front_path,
    "admin-private:cnic_front.jpg"
  );
  assert.equal(
    f.state.queries.some((q) =>
      /^(UPDATE|INSERT INTO|DELETE FROM) (users|city_to_city_)/.test(q.sql)
    ),
    false
  );
  const duplicate = await f.service.enroll(42, body);
  assert.equal(duplicate.already_submitted, true);
  assert.equal(f.state.drivers.length, 1);
});
test("options prefill own details and expose document availability without file keys or passwords", async () => {
  const f = fixture();
  const options = await f.service.options(42);
  assert.equal(options.prefill.Cnic, body.Cnic);
  assert.deepEqual(options.reusable_documents, [
    "Photo",
    "CNIC_Front",
    "CNIC_Back",
    "License",
  ]);
  assert.equal(options.vehicle.registration_document_available, true);
  assert.doesNotMatch(JSON.stringify(options), /admin-private|Password|hash/);
  await assert.rejects(f.service.options(999), { status: 403 });
});
test("different vehicle and missing/changed identity documents must be uploaded", async () => {
  for (const change of [
    { Vehicle_Type: "Bike" },
    { Vehicle_Number: "XYZ-987" },
    { Cnic: "4210112345672" },
  ]) {
    const f = fixture();
    await assert.rejects(f.service.enroll(42, { ...body, ...change }), {
      status: 400,
    });
    assert.equal(f.state.drivers.length, 0);
  }
  const f = fixture();
  await f.service.enroll(
    42,
    { ...body, Vehicle_Type: "Bike", Vehicle_Number: "BIKE-123" },
    { Vehicle_Running_Page: "admin-private:new-bike.jpg" }
  );
  assert.equal(
    f.state.drivers[0].vehicle_doc_path,
    "admin-private:new-bike.jpg"
  );
  assert.equal(f.vehicle.registration_number, "ABC-123");
  const missing = fixture({ missing: "license" });
  await assert.rejects(missing.service.enroll(42, body), { status: 400 });
  await missing.service.enroll(42, body, {
    License: "admin-private:new-license.jpg",
  });
  assert.equal(
    missing.state.drivers[0].license_path,
    "admin-private:new-license.jpg"
  );
});
test("new public driver creates user and FK-linked driver atomically; failed inserts leave no orphan user", async () => {
  const f = fixture({ existing: false, city: false });
  await f.service.registerPublic(body);
  assert.equal(f.state.users.length, 1);
  assert.equal(f.state.drivers[0].User_ID_FK, f.state.users[0].User_ID_Pk);
  assert.match(f.state.users[0].Password, /^\$2/);
  for (const setting of [{ failInsert: true }, { failCode: true }]) {
    const failed = fixture({ existing: false, ...setting });
    await assert.rejects(failed.service.registerPublic(body));
    assert.equal(failed.state.users.length, 0);
    assert.equal(failed.state.drivers.length, 0);
    assert.equal(failed.state.commits, 0);
  }
});
test("public signup cannot attach an existing phone without signing in or create duplicates concurrently", async () => {
  const existing = fixture();
  await assert.rejects(existing.service.registerPublic(body), { status: 409 });
  assert.equal(existing.state.drivers.length, 0);
  assert.equal(existing.state.users.length, 1);
  const f = fixture({ existing: false });
  const results = await Promise.allSettled([
    f.service.registerPublic(body),
    f.service.registerPublic(body),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.state.users.length, 1);
  assert.equal(f.state.drivers.length, 1);
});
test("forged mobile and inactive users cannot enroll against another account", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.enroll(42, { ...body, Mobile: "03007654321" }),
    { status: 400 }
  );
  f.state.users[0].AccountDeleted = 1;
  await assert.rejects(f.service.enroll(42, body), { status: 403 });
  assert.equal(f.state.drivers.length, 0);
});

test('a public driver without a password also receives a canonical linked personal account',async()=>{
 const f=fixture({existing:false,city:false});const {Password,...withoutPassword}=body;await f.service.registerPublic(withoutPassword);assert.equal(f.state.users[0].Password,null);assert.equal(f.state.drivers[0].password,null);assert.equal(f.state.drivers[0].User_ID_FK,f.state.users[0].User_ID_Pk);
});
