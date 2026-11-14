const test = require("node:test");
const assert = require("node:assert/strict");
const { configure } = require("../scripts/configureOffers");
const tables = [
  "users",
  "drivers",
  "ride_history",
  "driver_wallet",
  "user_wallets",
  "user_wallet_transactions",
  "driver_earnings",
];
function fixture({ columns = [], engine = "InnoDB" } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes("information_schema"))
        return [tables.map((TABLE_NAME) => ({ TABLE_NAME, ENGINE: engine }))];
      if (sql.startsWith("SHOW COLUMNS"))
        return [columns.map((Field) => ({ Field }))];
      return [{}];
    },
  };
}
test("offer migration dry run never mutates tables or balances", async () => {
  const db = fixture();
  assert.equal((await configure(db)).read_only, true);
  assert.equal(db.calls.length, 1);
});
test("migration rejects nontransactional wallets before writing", async () => {
  const db = fixture({ engine: "MyISAM" });
  await assert.rejects(configure(db, { apply: true }), /InnoDB/);
  assert.equal(db.calls.length, 1);
});
test("offer installation adds only missing columns and never rewrites historical financial rows", async () => {
  const db = fixture({ columns: ["Rider_Discount", "Customer_Payable"] });
  const result = await configure(db, { apply: true });
  assert.equal(result.existing_balances_changed, false);
  const alters = db.calls.filter((s) => s.startsWith("ALTER"));
  assert.equal(alters.length, 3);
  assert.ok(
    alters.every(
      (s) => !s.includes("Rider_Discount") && !s.includes("Customer_Payable"),
    ),
  );
  assert.ok(!db.calls.some((s) => /^(UPDATE|DELETE|TRUNCATE)\b/i.test(s)));
});
