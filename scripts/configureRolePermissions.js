async function configure(pool, { apply = false } = {}) {
  const [columns] = await pool.query("SHOW COLUMNS FROM assign_role_function");
  const missing = ["can_view", "can_add", "can_edit", "can_delete"].filter(
    (name) => !columns.some((c) => c.Field === name),
  );
  if (!apply)
    return {
      read_only: true,
      missing_columns: missing,
      message:
        "Use --apply to add missing permission columns. Existing grants are preserved; new columns default to zero.",
    };
  if (missing.length)
    await pool.query(
      `ALTER TABLE assign_role_function ${missing.map((name) => `ADD COLUMN ${name} TINYINT(1) NOT NULL DEFAULT 0`).join(", ")}`,
    );
  return {
    installed: true,
    columns_added: missing,
    permissions_auto_granted: false,
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
