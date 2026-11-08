# Admin overview

`GET /admin/overview?days=7`

Requires the same signed admin JWT as the driver APIs. Supported periods are `days=1` (today), `7`, and `30`; default is 7. Other values return 400. The endpoint is read-only and does not require a database migration.

## Metrics

- `accounts.total_users`: every non-deleted user account, including staff/admin, riders, and linked driver accounts.
- `accounts.total_riders`: non-deleted accounts whose normalized role is `rider`, `user`, `customer`, or empty/NULL. This excludes drivers and staff.
- `accounts.total_drivers`: driver profiles of all account statuses, including pending/blocked profiles. Driver profiles and user accounts are separate counts and should not be added together.
- `accounts.online_drivers`: approved active driver profiles with `Is_Online = 1`. This is database-reported presence, not a guarantee of a fresh GPS/socket heartbeat.
- `accounts.pending_drivers`: pending plus unverified profiles.
- `accounts.driver_statuses`: all-time counts by normalized driver account status.
- `rides.total`, `completed`, `cancelled`, `statuses`: current statuses of rides **requested in the selected period**, based on `Ride_Date`.
- `rides.completion_rate`: completed divided by all requested rides in the period, including rides still in progress. Zero when no rides exist.
- `rides.gross_fare`: recorded `Fare` for completed rides in that period.
- `rides.platform_fees`: recorded `Organization_Fee` for completed rides in that period. Neither revenue metric asserts settlement or cash collection.
- `daily`: one row per selected calendar day with total/completed/cancelled counts, gross fare, and platform fees. Missing days are filled with zeroes.
- `driver_cities`: all-time driver-profile counts by city, with empty city names grouped as `Unknown`.
- `recent_rides`: eight latest rides requested during the selected period, with safe rider/driver display names, route, recorded fare/status, and timestamp.

## Dates and consistency

Calendar boundaries and chart groups use **Asia/Karachi (UTC+05:00)**, irrespective of the API host's timezone. Date filters use epoch boundaries through `FROM_UNIXTIME`; daily grouping uses the timestamp epoch with a fixed +05:00 offset. This works with the configured UTC database session without relying on MySQL named-timezone tables. Recent ride timestamps are returned as epoch milliseconds to avoid client-driver timezone parsing differences.

Counts, daily aggregates, and recent rides are read from one repeatable-read, read-only transaction snapshot. The connection is released on success or failure, and failures roll back the snapshot. The transaction isolation setting applies to this transaction only.

The React overview keeps all-time account cards separate from period ride cards, supports exact graph values through **Show data**, and refreshes subscribed queries every 15 seconds while the tab is active. Focus/reconnect also refresh. Initial loading, empty data, and errors have explicit states; live failures never substitute sample metrics.

## Checks

```sh
node --test tests/admin-overview.test.js tests/admin-drivers.test.js
```

Backend checks cover role/count definitions, snapshot consistency, zero-filled series, invalid periods, empty data, Pakistan midnight boundaries, and unauthorized access. Browser checks cover totals, graph tables, date range changes, polling, errors, and mobile layout.
