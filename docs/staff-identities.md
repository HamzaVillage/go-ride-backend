# Independent staff identities

Administrative identities are stored exclusively in `employee`:

- `emp_id` is the staff identity; there is no `user_id` link.
- `password_hash` contains a bcrypt hash, never a plaintext password.
- `account_type` is `superadmin` or `employee`.
- `is_active` and `is_deleted` apply only to that staff login.

Creating/editing a staff account never inserts or updates `users`, including its
password, mobile, email or role. A rider/driver may independently use the same
email or phone as a staff member. A super administrator is a new employee record,
not an elevated rider record. Only super administrators can create, promote or
edit other super administrators. Self-demotion/status changes and self-assignment
of roles must be performed by another administrator.

`POST /auth/admin-login` retains `{email,password,security_code}` (code `0000`). It
reads only employee credentials, checks live employee access and issues an
eight-hour JWT with `auth_type: staff` and `employeeId`. The response keeps the
existing UI shape; `user.id` is now an employee ID. The response role `admin` means
a super-administrator employee, not `users.Role`. No hash is returned to the UI.

Every staff API rechecks the live employee and grants. The old
`EMPLOYEE_ACCESS_ENABLED=false` flag cannot bypass permissions. Old user-based
admin JWTs must sign in again. Staff JWTs cannot access mobile HTTP/socket APIs;
mobile JWTs, even with a legacy admin role or a matching numeric ID, cannot access
staff APIs. Existing configured service API keys remain separate integrations.

## Existing database upgrade

Deploy this backend and run:

```
npm run setup:staff-identities
npm run setup:staff-identities -- --apply
```

The first command previews the schema scope without changing data. The second:

1. Locks staff upgrades and puts staff sign-in/APIs in maintenance mode.
2. Saves a private recovery snapshot under `private_uploads/staff-migrations`.
3. Copies existing privileged credentials into independent employee identities;
   existing employee IDs, role assignments, inactive/deleted states are preserved.
   Historical actors without current staff privileges remain inactive.
4. Remaps staff review/settings/notification audit actors to employee IDs.
   Driver wallet admin top-ups use a distinct `created_by_employee_id` column;
   rider/system ledger actors and all balances/amounts remain unchanged.
5. Removes `employee.user_id` and its FK; staff audit FKs reference employee.
6. Removes temporary mapping data and ends staff maintenance.

It never changes or deletes a `users` row, including legacy privileged roles.
Those old roles no longer authenticate administrative sessions. Rider/driver
identity cleanup, if desired, is a separate explicitly reviewed data change.
Passwords are copied as hashes; the migration does not invent or reset passwords.
An active super administrator with a bcrypt password must exist before migration.
Ambiguous/missing emails or unknown historical actors stop migration for review.

MySQL/MariaDB DDL commits implicitly. Do not interrupt the migration. A recovery
state table makes a failed upgrade resumable with the same `--apply` command.
If it fails, staff maintenance remains enabled until the issue is resolved and
migration completes. The private recovery snapshot contains personal details and
credential hashes; do not move it into public uploads or commit it.

## Fresh database

Install employee-access tables before settings/city-to-city tables, because
administrative actor foreign keys now reference employee. Run
`npm run setup:employee-access -- --apply`, then configure
`STAFF_ADMIN_NAME`, `STAFF_ADMIN_EMAIL`, `STAFF_ADMIN_PHONE` and
`STAFF_ADMIN_PASSWORD` privately and run `npm run setup:staff-admin -- --create`.
The bootstrap command only works when no active super administrator exists.
Subsequent employees/super administrators are created through Employee access.
Passwords supplied for new accounts must be 12–72 UTF-8 bytes and at least 12
characters. Bootstrap passwords must not be placed in command-line arguments or
committed configuration.
