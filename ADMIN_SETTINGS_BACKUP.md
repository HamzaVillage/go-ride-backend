# Editable fares, operational settings and database downloads

## Setup

The admin panel Settings page now reads `GET /admin/settings`, edits the supported operational values with `PATCH /admin/settings`, and offers a draft fare preview. Both require the existing **settings** screen permission. Whole-database downloads require a signed, active bootstrap admin account; assigning an employee the Settings screen does not expose all customer, employee and financial records through a database export.

1. Existing vehicle prices and surcharge percentages read/update the existing `vehicle_fare_rate` table; service switches and dispatch radii use `sysconfigsetup`. They do not require new settings tables. Custom schedule storage and database-backed audit history are optional: `db/migrations/add_admin_settings.sql` adds `fare_policy` and `admin_setting_audit` without changing existing rates.
2. `npm run setup:admin-settings` prints the migration location without connecting or changing data. Run `npm run setup:admin-settings -- --apply` against the intended database after review. The setup verifies that existing settings/rate tables use InnoDB so the multi-table update can roll back atomically.
3. Deploy/restart the updated backend and rebuild the admin client. Existing employee/RBAC setup remains described in `EMPLOYEE_ACCESS.md`. When the schedule table has not been installed, public estimates retain the default schedule and the admin editor disables only custom time-window/rounding controls. Existing rate, surcharge-percentage, service and dispatch controls remain editable. When the optional audit table is absent, successful edits are recorded in structured API logs instead; other audit/database failures still roll back the update.
4. Install a compatible MySQL dump client or MariaDB dump client on the API server for database downloads. Set `MYSQLDUMP_PATH` to its executable path if it is not on the server's PATH. The current workspace does not have a dump executable installed. No real database export, migration, or restore was performed during implementation/testing.

## Editable values

- Per vehicle: base fare, per-km rate, per-minute/waiting rate, organization fee, peak/night percentages, minimum billable distance, maximum trip distance, active status, ride limit and the existing over-limit/wallet threshold. Vehicle names, IDs and PKR currency remain fixed because other existing ride/driver records reference these identities.
- Peak pricing: enabled switch, up to eight start/end windows and weekdays. Night pricing: enabled switch and daily start/end times. Times are interpreted in Asia/Karachi. End times are exclusive. Overnight peak windows belong to their starting weekday, including their after-midnight portion.
- Included base-fare kilometers and upward rounding increment.
- Ride/courier/food/grocery service switches, customer fare-adjustment switch, initial and maximum driver-search radius.

Existing `rides_over_limit_count` is coupled: the backend uses it for both over-limit ride counting and the minimum wallet threshold. The editor labels this explicitly. A value of zero retains the existing PKR 300 minimum-wallet fallback. This change does not migrate balances or reinterpret legacy driver debt rules.

Fare formula: base plus additional billable kilometers plus trip/waiting minutes; peak and night percentages are added to that subtotal; organization fee is then added; the result is rounded upward using the configured increment. Minimum distance now acts as a billable-distance floor and maximum distance determines whether a category can quote that trip. The default 1 included km, 10 PKR rounding, 08:00–11:00 / 17:00–20:00 peak windows and 22:00–06:00 night window preserve the existing defaults.

The public fare endpoint resolves peak/night status on the server even when an older mobile client submits its own flags. It supports GET query input and POST JSON. The updated mobile client stops hardcoding time flags and refreshes public service configuration on foreground and every 30 seconds while active, retaining its last good configuration during errors. Public service/dispatch caches last up to 5 seconds. Disabling ride service blocks new estimates and new ride creation; existing ride recovery, tracking and completion remain available. Previously stored ride fares are not rewritten. The existing negotiated-fare submission/settlement contract remains intact.

Updates are reviewed before confirmation. The backend validates all fields, locks current configuration, checks the submitted SHA-256 version, and saves service flags, policy, changed rate rows and, when installed, actor/before/after database audit together. Without the optional audit table, the API logs the actor and before/after configuration after a successful commit. A conflict returns 409. Background client refreshes never upgrade an unsaved draft's version. Draft preview validates the same configuration and never creates a ride or saves settings.

## Daily backup button

`POST /admin/settings/backup` creates a fresh `.sql.gz` attachment when clicked. `GET /admin/settings/backup/status` reports client availability and snapshot mode. This is an on-demand daily-use button, not a scheduled job. No database target, password or SQL command can be supplied by the browser. DB connection settings come only from the server configuration.

The export includes the entire configured application database: table definitions/data, views, triggers, stored routines and events. It is not a server-wide dump of unrelated databases, MySQL accounts or grants, and it does not include uploaded files from filesystem/object storage. Back up private/public upload directories separately if they are required for a complete application recovery.

The implementation uses a private 0600 option file, an argument-array subprocess with no shell, low-overhead gzip streaming to a private temporary archive, a database advisory lock to prevent concurrent exports, a preparation timeout, cancellation, and cleanup after download/disconnect. Credentials and dump stderr are never returned to the client or placed in command-line arguments. Archives are not served from `/uploads`, stored in Redux, or exposed using public links. Backend responses are no-store attachments and expose the filename for the separate admin origin.

For all-InnoDB databases, the dump uses a consistent transaction. If non-transactional tables such as MyISAM exist, it uses a global read lock while writing the compressed archive locally. **That lock pauses writes across the database server until export finishes**, so the UI explains it before download. The lock is released before transferring the completed archive to the browser; slow internet does not prolong it. Avoid simultaneous schema migrations during backups. These options follow the [official MySQL dump documentation](https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html).

The dump account needs the relevant SELECT, SHOW VIEW, TRIGGER, EVENT and stored-routine visibility permissions; mixed-engine consistent exports additionally need global-read-lock privileges. `--no-tablespaces` avoids tablespace export and its PROCESS requirement. Check the installed client's version against the database server, especially for MySQL versus MariaDB. `MYSQLDUMP_PATH` can point to `mariadb-dump`. MySQL 8+ receives `--column-statistics=0`; MySQL clients also disable exported GTID-purged state. Deployment-specific TLS options must match the database connection's security requirements.

Default preparation deadline is 5 minutes (`DATABASE_BACKUP_TIMEOUT_MS`, capped at 30 minutes). The compressed archive limit is 5 GiB; the browser download uses a Blob, so practical browser memory limits also apply. Duration depends on actual data size, server performance, existing locks and network speed; there is no fixed seconds guarantee. A failed/cancelled export is never presented as a complete backup. A server crash can leave a private temporary archive for operator/OS cleanup; no durable archive history is maintained by this button.

Test restore downloaded archives on an isolated MySQL instance before relying on them. SQL dumps retain the original database name. No restore/import endpoint is provided.

## Verification scope

Backend tests use a transactional database double and synthetic dump subprocesses: fare math, time boundaries/overnight weekdays, validation, rollback, conflict handling, credential escaping, dump flags, gzip contents, cancellation, size limits, file permissions and authenticated download restrictions. Browser tests use mocked API responses and a small synthetic SQL archive to verify review/save, preview, concurrent edits, missing-utility handling, employee restrictions, mobile layout and a gzip download. These are not real database export/restore tests.
