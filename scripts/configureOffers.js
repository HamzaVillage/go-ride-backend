const fs = require("node:fs/promises");
const path = require("node:path");
async function configure(pool, { apply = false } = {}) {
  const [engines] = await pool.query(
    "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('users','drivers','ride_history','driver_wallet','user_wallets','user_wallet_transactions','driver_earnings')",
  );
  if (
    engines.length !== 7 ||
    engines.some((row) => String(row.ENGINE).toLowerCase() !== "innodb")
  )
    throw new Error(
      "Offers require all existing account, ride, and wallet tables to use InnoDB.",
    );
  if (!apply)
    return {
      read_only: true,
      message:
        "Use --apply to install offer storage, then enable OFFERS_ENABLED=true after deploying the updated mobile app.",
    };
  const sql = (
    await fs.readFile(
      path.join(__dirname, "../db/migrations/add_offers.sql"),
      "utf8",
    )
  ).replace(/^\s*--.*$/gm, "");
  for (const statement of sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await pool.query(statement);
  const [columns] = await pool.query("SHOW COLUMNS FROM ride_history");
  const fields = {
    Rider_Discount: "DECIMAL(10,2) NOT NULL DEFAULT 0",
    Customer_Payable: "DECIMAL(10,2) NULL",
    Rider_Offer_ID: "BIGINT UNSIGNED NULL",
    Driver_Offer_ID: "BIGINT UNSIGNED NULL",
    Driver_Commission_Waived: "TINYINT(1) NOT NULL DEFAULT 0",
  };
  for (const [name, type] of Object.entries(fields))
    if (!columns.some((c) => c.Field === name))
      await pool.query(`ALTER TABLE ride_history ADD COLUMN ${name} ${type}`);
  return {
    installed: true,
    existing_balances_changed: false,
    enable_after_mobile_deployment: "OFFERS_ENABLED=true",
  };
}
if (require.main === module) {
  const pool = require("../db/Connect_Db");
  configure(pool, { apply: process.argv.includes("--apply") })
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(e.code || e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
module.exports = { configure };
