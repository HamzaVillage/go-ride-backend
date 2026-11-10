# Admin rides, riders, and support

All routes require a signed admin Bearer token, return `Cache-Control: no-store, private`, and are read-only. Deploy the updated backend together with the admin panel.

- `GET /admin/rides`: joins ride history to rider and driver names. Search matches numeric ride ID, names, and pickup/destination. Status: `requested`, `accepted`, `arrived`, `started`, `completed`, `cancelled`, `rejected`, or `all`.
- `GET /admin/riders`: customer accounts with normalized roles `rider`, `user`, `customer`, or blank/null. Driver and admin accounts are excluded. Search matches numeric user ID, name, phone, email, and city. Status: `active`, `deleted`, or `all`. Total rides counts all history for the user; account status reflects `AccountDeleted`.
- `GET /admin/support`: saved `complaints` submitted by the app, with user identity, category, full message, and optional stored status/date. Search matches name, phone, category, message, and user ID. Website `/support/message` sends email only and is not included.

Query parameters: `q` (up to 100 characters), `page` (positive integer, default 1), `limit` (1–100, default 20), `status` (default `all`; support accepts only `all`). Invalid input returns HTTP 400. Searches use bound parameters and escape SQL wildcard characters.

Success envelope: `{ success: true, data: { rides|riders|queries: [...], pagination: { page, limit, total, totalPages } } }`. Dates are epoch milliseconds (or null); fares/counts are numeric. The frontend formats dates in Asia/Karachi. Lists sort newest first, use bounded pages, and poll while focused every 15 seconds.

The complaints table was absent from the checked-in schema dump. Its required content columns follow the existing submission controller: `user_id`, `full_name`, `mobile_number`, `category`, `issue_description`. The reader checks metadata for `id`, `complaint_id`, or `Complaint_ID_Pk`; optional dates are `created_at`, `CreatedAt`, `created_on`, or `submitted_at`, and optional status is `status` or `complaint_status`. Missing optional fields display an unavailable date and `submitted` status. Missing/unsupported tables return an API error; no tables or records are created during reads.

Verification: `node --test tests/admin-directories.test.js tests/admin-drivers.test.js tests/admin-overview.test.js`. Frontend: production build, session tests, and `tests/browser/directories.spec.js` use mocked API responses; these do not establish connectivity to a deployed database.
