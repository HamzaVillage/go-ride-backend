# Screen and action permissions

Numeric `employee_function.function_code` values map to canonical API screens:
01 Overview, 02 Rides, 03 Drivers, 04 Riders, 05 Franchises, 06 Chat reports,
07 Support queries, 08 Notifications, 09 Settings, 10 Employee access,
11 Offers, 12 City-to-City Drivers (including wallets/top-ups),
13 City-to-City Service & Fares, 14 City-to-City Route Fares,
15 City-to-City Fare Calculator, 16 Franchise Drivers & Riders.
Legacy text codes remain valid aliases. Existing function IDs, role assignments,
passwords, wallet balances and historical records are not rewritten. Catalog
installers check both aliases before inserting missing screens.

## Rollout

1. Back up the database. From the backend folder, run `npm run setup:role-permissions`
   for a read-only check, then `npm run setup:role-permissions -- --apply` if columns
   are missing. The installer adds only missing `can_view`, `can_add`, `can_edit`
   and `can_delete` TINYINT columns, defaulting to zero. Existing values are preserved.
   A fresh employee-access installation includes these columns as well.
2. Optional: execute `db/migrations/insert_missing_role_screen_permissions.sql`.
   It adds absent role/screen pairs with four zero flags, never updates existing
   grants and never reactivates deleted assignments. The UI also creates/updates
   selected pairs when saving a role, so these placeholder rows are not required.
3. Deploy the updated backend and admin build together, then restart the backend.
4. Sign in as an active super administrator. Under Employee access → Roles & screens,
   edit a role and select View/Add/Edit/Delete for each screen, or All. Save the role,
   then assign that role to the intended employee. All-zero pairs grant no access.

No production schema upgrade or live permission change was executed during development.

## Rules

View is required to open the screen and read its resources. Add/Edit/Delete are
separate write grants, not implied by View. Selecting a write action in the UI
also selects View; clearing View clears the row. Effective grants are the union
of the employee's active roles. Inactive/deleted employees, roles, assignments
and screens cannot grant access. Super administrators retain full access.
Only super administrators may change role permissions, screen activation or
employee role assignments; Employee access Edit cannot be used to escalate rights.

The server checks every request. Write services recheck the corresponding action
inside their existing transactions. A missing permission column fails closed.
The frontend receives both visible canonical screen keys and per-screen action
flags from `/admin/me`; the sidebar, buttons and forms use these current grants.
Permissions refresh on focus/reconnect and every 15 seconds. A 403 refreshes access
without signing out the employee; 401 still clears the expired/inactive session.

Creating drivers, offers, franchise members, direct wallet top-ups and notification
sends uses Add. Editing profiles/documents, approvals, payment reviews, configuration,
pausing/closing offers and changing tariffs uses Edit. DELETE requests and
`is_deleted: true` mutations use Delete. Read-only fare calculators use View even
when their endpoint is POST. Whole-database backups remain superadmin-only.
A permission does not create new delete APIs on screens which have no deletion action.

Browser checks run on an isolated fixture Vite server with the API explicitly set
to localhost. They do not use the production URL or mutate live records. Backend
fixtures cover numeric mapping, zero grants, action separation, revocation, malformed
permission payloads, escalation prevention and the default-deny installer. Staging
MySQL and real employee sessions still require deployment verification.

Verification for this change: 382 backend tests passed (one existing skip), 17 admin
unit tests passed, and 50 distinct targeted mocked browser checks passed across
permissions, employee management, offers, settings, wallets, driver registration,
profile edits, top-ups, notifications and admin operations. The production admin
build passed. The matrix was visually inspected at desktop and 390px mobile widths.
