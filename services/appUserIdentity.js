const { fail } = require("./employeeAccess");
const { phoneOf } = require("./cityToCityIdentity");
const USER_PHONE_SQL =
  "REPLACE(REPLACE(REPLACE(Mobile,'-',''),' ',''),'+','') IN (?,?)";
const phoneArgs = (phone) => [phone, `92${phone.slice(1)}`];
async function acquirePhoneLock(conn, phone) {
  const name = `app-user-phone:${phone}`,
    [[row]] = await conn.query("SELECT GET_LOCK(?,10) AS acquired", [name]);
  if (Number(row?.acquired) !== 1)
    throw fail(409, "This phone is being registered. Please try again.");
  return name;
}
async function releasePhoneLock(conn, name) {
  if (name) await conn.query("SELECT RELEASE_LOCK(?)", [name]).catch(() => {});
}
module.exports = {
  USER_PHONE_SQL,
  phoneArgs,
  phoneOf,
  acquirePhoneLock,
  releasePhoneLock,
};
