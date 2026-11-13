const test = require("node:test"),
  assert = require("node:assert/strict"),
  { createHash } = require("node:crypto");
const { createMobileAuth } = require("../services/mobileAuth");
const hash = (v) => createHash("sha256").update(v).digest("hex");
function fixture({
  mode = null,
  role = "rider",
  driver = false,
  city = false,
  deleted = false,
  duplicate = false,
  status = "active",
  existing = true,
} = {}) {
  const state = {
    users: existing
      ? [
          {
            User_ID_Pk: 42,
            User_Name: "Ali",
            Mobile: "03001234567",
            Email: "ali@example.com",
            Role: role,
            last_active_mode: mode,
            AccountDeleted: deleted ? 1 : 0,
          },
        ]
      : [],
    otp: null,
    queries: [],
    sent: 0,
    commits: 0,
    rollbacks: 0,
    clockRecent: false,
    failInsert: false,
  };
  const conn = {
    async beginTransaction() {},
    async commit() {
      state.commits++;
    },
    async rollback() {
      state.rollbacks++;
    },
    release() {},
    async query(sql, args = []) {
      state.queries.push({ sql, args });
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{}]];
      if (sql.includes("SELECT User_ID_Pk,User_Name"))
        return [
          duplicate
            ? [state.users[0], { ...state.users[0], User_ID_Pk: 55 }]
            : state.users,
        ];
      if (sql.includes("FROM users WHERE Email")) return [[]];
      if (sql.includes("FROM drivers"))
        return [
          driver ? [{ id: 25, User_ID_FK: 42, status, full_name: "Ali" }] : [],
        ];
      if (sql.includes("FROM city_to_city_drivers"))
        return [
          city
            ? [
                {
                  id: 7,
                  application_status: "pending",
                  driver_code: "CTC_0007",
                },
              ]
            : [],
        ];
      if (sql.includes("created_at>"))
        return [state.clockRecent ? [{ id: 1 }] : []];
      if (sql.startsWith("INSERT INTO otp_verifications")) {
        state.otp = {
          id: 1,
          otp_hash: args[1],
          purpose: args[2],
          payload: args[3],
          attempts: 0,
        };
        return [{}];
      }
      if (sql.startsWith("SELECT id,otp_hash"))
        return [state.otp && state.otp.purpose === args[1] ? [state.otp] : []];
      if (sql.startsWith("UPDATE otp_verifications")) {
        state.otp.attempts++;
        return [{}];
      }
      if (sql.startsWith("DELETE FROM otp_verifications")) {
        state.otp = null;
        return [{}];
      }
      if (sql.startsWith("INSERT INTO users")) {
        if (state.failInsert) throw new Error("INSERT_FAILED");
        state.users.push({
          User_ID_Pk: 42,
          User_Name: args[0],
          Email: args[1],
          Mobile: args[2],
          Role: args[3],
          last_active_mode: args[5],
        });
        return [{ insertId: 42 }];
      }
      if (sql.startsWith("UPDATE users SET last_active_mode")) {
        state.users[0].last_active_mode = args[0];
        return [{}];
      }
      throw new Error(sql);
    },
  };
  const service = createMobileAuth({
    pool: { getConnection: async () => conn },
    sendOtp: async () => {
      state.sent++;
      return "123456";
    },
    signToken: (claims) => {
      state.claims = claims;
      return "signed";
    },
  });
  const verify = () =>
    service.verify({
      phone: "03001234567",
      otp: "123456",
      otp_purpose: state.otp?.purpose || "mobile_login",
    });
  return { state, service, verify };
}
test("one password-free OTP login restores each server-selected mode and canonical user identity", async () => {
  for (const mode of ["rider", "driver", "city_to_city_driver"]) {
    const f = fixture({ mode, driver: true, city: true });
    const sent = await f.service.send({
      phone: "+92 3001234567",
      password: "ignored",
    });
    assert.equal(sent.otp, undefined);
    assert.equal(f.state.otp.otp_hash, hash("123456"));
    const r = await f.verify();
    assert.equal(r.active_mode, mode);
    assert.equal(r.user.id, 42);
    assert.equal(f.state.claims.userId, 42);
    assert.equal(r.profile.id, mode === "driver" ? 25 : 42);
    assert.equal(f.state.claims.role, mode === "driver" ? "driver" : "rider");
    assert.equal(f.state.otp, null);
    assert.equal(f.state.users.length, 1);
    assert.equal(f.state.users[0].Role, "rider");
    await assert.rejects(f.verify(), { status: 400 });
  }
});
test("legacy accounts infer initial mode from their linked profiles without rewriting roles", async () => {
  for (const [config, expected] of [
    [{ driver: true, role: "driver" }, "driver"],
    [{ city: true }, "city_to_city_driver"],
    [{}, "rider"],
  ]) {
    const f = fixture(config);
    await f.service.send({ phone: "03001234567" });
    assert.equal((await f.verify()).active_mode, expected);
  }
});
test("existing driver keeps the original dashboard while unfinished signup resumes onboarding", async () => {
  const pending = fixture({ mode: "driver", driver: true, status: "pending" });
  await pending.service.send({ phone: "03001234567" });
  const p = await pending.verify();
  assert.equal(p.driver_application_only, false);
  assert.equal(p.profile.status, "pending");
  assert.equal(pending.state.claims.role, "rider");
  const missing = fixture({ mode: "city_to_city_driver" });
  await missing.service.send({ phone: "03001234567" });
  assert.equal((await missing.verify()).needs_onboarding, true);
});
test("password-free signup creates one verified personal user with selected signup mode", async () => {
  for (const mode of ["rider", "driver", "city_to_city_driver"]) {
    const f = fixture({ existing: false });
    await f.service.send(
      {
        phone: "03001234567",
        full_name: "Ali",
        email: "ali@example.com",
        signup_mode: mode,
      },
      true
    );
    assert.equal(f.state.users.length, 0);
    const r = await f.verify();
    assert.equal(r.active_mode, mode);
    assert.equal(r.needs_onboarding, mode !== "rider");
    assert.equal(f.state.users.length, 1);
    const insert = f.state.queries.find((q) =>
      q.sql.startsWith("INSERT INTO users")
    );
    assert.match(insert.sql, /Password.*NULL/);
    assert.equal(f.state.users[0].Role, "rider");
    assert.equal(f.state.otp, null);
  }
});
test("incorrect codes commit attempts, fifth attempt blocks, wrong purpose and consumed codes fail", async () => {
  const f = fixture();
  await f.service.send({ phone: "03001234567" });
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      f.service.verify({
        phone: "03001234567",
        otp: "000000",
        otp_purpose: "mobile_login",
      }),
      { status: 400 }
    );
  assert.equal(f.state.otp.attempts, 5);
  await assert.rejects(f.verify(), { status: 400 });
  assert.equal(f.state.sent, 1);
  const g = fixture();
  await g.service.send({ phone: "03001234567" });
  await assert.rejects(
    g.service.verify({
      phone: "03001234567",
      otp: "123456",
      otp_purpose: "mobile_register",
    }),
    { status: 400 }
  );
  assert.equal(g.state.users.length, 1);
});
test("deleted, staff, duplicate and unknown phones cannot receive app login tokens; resend is bounded", async () => {
  for (const config of [
    { deleted: true },
    { role: "employee" },
    { role: "admin" },
    { duplicate: true },
    { existing: false },
  ]) {
    const f = fixture(config);
    await assert.rejects(f.service.send({ phone: "03001234567" }));
    assert.equal(f.state.sent, 0);
    assert.equal(f.state.claims, undefined);
  }
  const f = fixture();
  f.state.clockRecent = true;
  await assert.rejects(f.service.send({ phone: "03001234567" }), {
    status: 429,
  });
  assert.equal(f.state.sent, 0);
  await assert.rejects(f.service.send({ phone: "123" }), { status: 400 });
});
test("signup race against an existing account never replaces personal credentials or adds another user", async () => {
  const f = fixture({ existing: false });
  await f.service.send(
    { phone: "03001234567", full_name: "Ali", email: "ali@example.com" },
    true
  );
  f.state.users.push({ User_ID_Pk: 42, Mobile: "03001234567", Role: "rider" });
  await assert.rejects(f.verify(), { status: 409 });
  assert.equal(f.state.users.length, 1);
  assert.equal(
    f.state.queries.some((q) => q.sql.startsWith("INSERT INTO users")),
    false
  );
});

test('legacy mixed-case active status restores the existing driver dashboard and driver token',async()=>{
 for(const status of ['Active','ACTIVE',' active ']){
  const f=fixture({mode:'driver',driver:true,status});await f.service.send({phone:'03001234567'});const s=await f.verify();assert.equal(s.profile.status,'active');assert.equal(s.driver_application_only,false);assert.equal(s.needs_onboarding,false);assert.equal(f.state.claims.role,'driver');
 }
});
