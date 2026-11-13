const fs = require("node:fs/promises"),
  path = require("node:path");
async function main() {
  if (!process.argv.includes("--apply")) {
    console.log(
      "Use --apply to add users.last_active_mode; no accounts, roles or passwords are changed."
    );
    return;
  }
  const pool = require("../db/Connect_Db");
  try {
    const sql = (
      await fs.readFile(
        path.join(
          __dirname,
          "../db/migrations/add_mobile_last_active_mode.sql"
        ),
        "utf8"
      )
    ).replace(/^\s*--.*$/gm, "");
    await pool.query(sql);
    const [rows] = await pool.query(
      "SELECT DATA_TYPE,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_active_mode'"
    );
    if (!rows[0]?.COLUMN_TYPE.includes("city_to_city_driver"))
      throw new Error("Mode column validation failed");
    console.log(
      "Unified mobile login mode column ready. Existing roles, passwords and user links preserved."
    );
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error("Mobile auth setup failed:", e.code || e.message);
  process.exitCode = 1;
});
