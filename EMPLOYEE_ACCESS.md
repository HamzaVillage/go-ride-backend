# Employees, roles and screen access

The existing backend uses MySQL/MariaDB. `dbo` is a SQL Server schema prefix, so the five tables are created in the configured MySQL database without that prefix.

## Install

1. Review `db/migrations/add_employee_access.sql` against the intended database and take the normal database backup. The migration adds tables and missing screen seeds; it does not change existing users, balances or rides. MySQL DDL commits independently, so an interrupted migration may be partially installed. Re-running it does not reset existing role grants or screen states.
2. Run `npm run setup:employee-access` to print the migration location without connecting or writing. Run `npm run setup:employee-access -- --apply` to install. The script verifies required columns; existing incompatible tables need a separately reviewed upgrade.
3. Set `EMPLOYEE_ACCESS_ENABLED=true` and restart the backend. Keep the private employee document directory backed up and outside the publicly served uploads directory. No live migration or employee account is created automatically during application startup.
4. Sign in as an existing `users.Role = admin` account. Open **Employee access**, create a role, select its screens, create an employee and assign one or more roles. The employee uses the same email/password/four-digit-code login screen. The existing security code remains `0000`.

## Schema

- `employee`: employee ID, unique immutable user link, name, email, phone, CNIC, father's name/CNIC, full address, three private document references, optimistic version.
- `employee_role`: role ID, unique name, description, optimistic version.
- `employee_function`: function ID, name, stable unique screen code, optimistic version. The seeded catalog contains the actual admin routes; adding a future screen requires registering its server route, client route and catalog code together.
- `assign_role`: unique `(emp_id, role_id)`; supports multiple roles per employee.
- `assign_role_function`: unique `(role_id, function_id)`.
- Every table includes `created_at`, `created_by`, `updated_at`, `updated_by`, `is_active` and `is_deleted`. Actor IDs refer to authenticated `users.User_ID_Pk`; initial migration seeds use a null system creator. Times follow the existing database timezone. Assignments preserve their original creator/time when reactivated.
- Foreign keys protect employee/role/function relationships; reverse indexes support role and screen lookups. Employee email/CNIC and user links cannot be reused by soft-deleting a record. Lists are paginated and parameterized. Employee directory results omit family details, CNIC, full address, credentials and raw file paths.

## Authorization and identity

Employee creation inserts a bcrypt credential in `users` with `Role = employee` and the linked employee profile in one transaction. Staff JWTs carry `role=employee`; the normal rider/driver APIs reject them. Customer OTP issuance and phone-password reset exclude employee accounts. Existing admin accounts remain bootstrap administrators and keep all screens; an orphaned employee user never receives bootstrap access. Disabling the rollout rejects employee tokens and does not promote them to admins.

Every protected admin request resolves current employee/account status and the union of active, non-deleted role assignments, roles, role-screen grants and registered functions. There are no permission grants embedded in the JWT to become stale. Employee inactivity/deletion rejects sessions; role/function/grant changes take effect on the next server request. The client refreshes permissions on focus/reconnect and every 15 seconds while active, filters navigation, and blocks direct routes. A 401/403 clears session credentials and query caches, following the existing session policy.

Screen permission applies to that screen's read and write operations. **Employee access** is privileged: it includes managing employee profiles, documents, roles and grants. Only give it to trusted access administrators. Existing explicitly configured service keys for notifications/chat reports retain their previous integration contract; they are not employee credentials. Public mobile service configuration remains public by design and contains no employee data.

Driver changes/top-ups keep their existing actor audit and idempotency behavior. They additionally recheck current driver-screen access inside their write transaction when RBAC is enabled. Permission-management writes lock and recheck the actor's access, validate selected targets and commit profile/grant updates atomically. Version conflicts return 409 instead of silently overwriting another administrator. Employees cannot change their own roles or deactivate/delete themselves; another access administrator must do it.

Identity documents accept signature-checked JPEG, PNG, WebP, AVIF or PDF, up to 8 MB each. Files have generated names and private filesystem permissions. Reads require the employee-management screen permission and return no-store, nosniff/sandbox headers. Replacements retain earlier private files rather than destroying identity records. Configure storage retention separately. One supporting document slot is provided; the two CNIC slots are separate.

## Endpoints

All below require a signed admin/employee session; `/admin/employees/**` also requires `employees` screen access and enabled rollout.

- `GET /admin/me`: current effective screen codes and bootstrap/employee identity.
- `GET /admin/employees?q=&status=all|active|inactive&page=1&limit=20`
- `POST /admin/employees`, `GET /admin/employees/:id`, `PATCH /admin/employees/:id`
- `GET /admin/employees/catalog`: roles, screen IDs/codes and current role grants.
- `POST /admin/employees/roles`, `PATCH /admin/employees/roles/:id`
- `PATCH /admin/employees/functions/:id`: change registered screen label/status; codes are immutable.
- `GET|POST /admin/employees/:id/documents/cnic_front|cnic_back|other_document`: multipart `document` and current `version` on uploads.

Employee payload: `name`, `email`, `phone`, optional `cnic`, `father_name`, `father_cnic`, `address`, `is_active`, `role_ids`. Creation requires a password of at least 12 characters and at most 72 UTF-8 bytes; editing can optionally reset it. Role payload: `role_name`, `role_description`, `is_active`, `function_ids`. PATCH requests require the version read from the latest employee/role/function record. `is_deleted=true` is supported on employee/role PATCH; grant removal is soft deletion. Audit/identity/document-path fields cannot be supplied in JSON.

Verification uses mocked SQL/auth/transaction tests and mocked browser flows; it does not create production employees or change real financial balances. A successful JS build is not a live database migration verification.
