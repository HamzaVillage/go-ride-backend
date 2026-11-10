# Admin franchise directory

Read-only integration using the existing `franchiser` table. Deploy the updated backend with the admin panel. No schema migration or real writes are performed.

- `GET /admin/franchises?q=&status=all&page=1&limit=20`: paginated company/contact/location summaries, status, profile completion, created date, linked driver count, and linked active rider/user count.
- `GET /admin/franchises/:id`: full business/contact/address fields, fees, contract terms, notes, timestamps, and linked counts. Unknown IDs return 404; malformed IDs return 400.

Both routes require the existing signed admin JWT and return private/no-store responses. The list accepts status `all`, `active`, `inactive`, `pending`, or `suspended`. Search (maximum 100 characters) matches ID, company/legal name, contact person, email, phone, city, and area with bound parameters and escaped wildcards. Page is positive; limit is 1–100. Order: newest ID first.

Envelope: `{ success: true, data: { franchises: [...], pagination: { page, limit, total, totalPages } } }`; detail `data` is the franchise object. Dates use epoch milliseconds, numeric fields are numbers or null, and `profile_complete` is boolean. Driver count uses `drivers.Franchiser_ID_FK`; rider count uses non-deleted `users.Franchiser_ID_FK` restricted to customer roles. Counts are separate subqueries to avoid multiplying rows. Stored fees are displayed without an invented currency because the schema has no currency column.

The admin route `/franchises` supports search, status filters, pagination, CSV export of the current page, and details. Queries poll every 15 seconds while focused and refetch on focus/reconnect. Demo mode displays an informational message and makes no franchise requests. API errors never substitute sample data. Creating/editing/deleting franchises is outside this read-only integration.

Verification uses fake database fixtures and mocked browser API responses. No live APIs, database writes, or notifications are used.
