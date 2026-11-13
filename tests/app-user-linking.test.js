const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
function fixture({
  user = {
    User_ID_Pk: 42,
    Mobile: "03001234567",
    Role: "rider",
    AccountDeleted: 0,
  },
  driverFk = 42,
  register = false,
} = {}) {
  const state = {
    queries: [],
    commits: 0,
    rollbacks: 0,
    released: false,
    claims: null,
  };
  const conn = {
    async beginTransaction() {},
    async commit() {
      state.commits++;
    },
    async rollback() {
      state.rollbacks++;
    },
    release() {
      state.released = true;
    },
    async query(sql, args) {
      state.queries.push({ sql, args });
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{}]];
      if (sql.includes("FROM otp_verifications"))
        return [
          [
            {
              purpose: register ? "register" : "driver_login",
              otp_hash: "111111",
              payload: "{}",
            },
          ],
        ];
      if (sql.includes("FROM users")) return [user ? [user] : []];
      if (sql.includes("FROM drivers"))
        return [
          [
            {
              id: 25,
              User_ID_FK: driverFk,
              full_name: "Ali",
              phone: "03001234567",
              status: "active",
            },
          ],
        ];
      if (sql.startsWith("INSERT INTO users")) return [{ insertId: 99 }];
      return [{}];
    },
  };
  const deps = {
    "../db/Connect_Db": { getConnection: async () => conn },
    jsonwebtoken: {
      sign(claims) {
        state.claims = claims;
        return "token";
      },
    },
    "../utils/driverHelper": { formatDriverCode: (id) => `GRD-${id}` },
  };
  const context = {
    module: { exports: {} },
    console: { log() {}, error() {} },
    process,
    require: (id) => (id in deps ? deps[id] : require(id)),
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../controller/authController.js"),
      "utf8"
    ),
    context
  );
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  return { state, res, controller: context.module.exports };
}
test("normal driver OTP reuses an existing rider identity and repairs a missing driver FK without another user", async () => {
  for (const driverFk of [42, null]) {
    const f = fixture({ driverFk });
    await f.controller.driverVerifyOtp(
      { body: { phone: "03001234567", otp: "111111" } },
      f.res
    );
    assert.equal(f.res.statusCode, 200);
    assert.equal(f.state.claims.userId, 42);
    assert.equal(f.state.commits, 1);
    assert.equal(
      f.state.queries.some((q) => q.sql.startsWith("INSERT INTO users")),
      false
    );
    assert.equal(
      f.state.queries.some((q) =>
        q.sql.startsWith("UPDATE drivers SET User_ID_FK")
      ),
      driverFk === null
    );
    assert.equal(f.state.released, true);
  }
});
test("legacy unlinked driver gets one user and its foreign key in the same committed transaction", async () => {
  const f = fixture({ user: null, driverFk: null });
  await f.controller.driverVerifyOtp(
    { body: { phone: "03001234567", otp: "111111" } },
    f.res
  );
  assert.equal(f.res.statusCode, 200);
  assert.equal(f.state.claims.userId, 99);
  const link = f.state.queries.find((q) =>
    q.sql.startsWith("UPDATE drivers SET User_ID_FK")
  );
  assert.deepEqual(Array.from(link.args), [99, 25]);
  assert.equal(f.state.commits, 1);
});
test("conflicting driver/user linkage never issues a token or silently changes ownership", async () => {
  const f = fixture({ driverFk: 77 });
  await f.controller.driverVerifyOtp(
    { body: { phone: "03001234567", otp: "111111" } },
    f.res
  );
  assert.equal(f.res.statusCode, 409);
  assert.equal(f.state.claims, null);
  assert.equal(f.state.rollbacks, 1);
  assert.equal(
    f.state.queries.some(
      (q) =>
        q.sql.startsWith("INSERT INTO users") ||
        q.sql.startsWith("UPDATE drivers")
    ),
    false
  );
});
test("OTP registration rejects a phone created meanwhile instead of duplicating a personal user", async () => {
  const f = fixture({ register: true });
  await f.controller.verifyOtp(
    { body: { phone_number: "03001234567", otp: "111111" } },
    f.res
  );
  assert.equal(f.res.statusCode, 409);
  assert.equal(f.state.claims, null);
  assert.equal(
    f.state.queries.some((q) => q.sql.startsWith("INSERT INTO users")),
    false
  );
  assert.equal(f.state.rollbacks, 1);
  assert.equal(f.state.released, true);
});
