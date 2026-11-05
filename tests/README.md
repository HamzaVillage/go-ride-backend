# Ride acceptance verification

Run `npm test` from the backend directory. The tests use a transactional row-locking
database double and stub notifications. They do not connect to MySQL or validate
actual MySQL lock/isolation behavior.

## Deployment prerequisite

Before deploying this controller, apply
`db/migrations/enable_driver_ride_locking.sql` to the intended database during a
maintenance window after taking a backup. The checked-in schema previously used
MyISAM for `drivers`; its row locks would not protect concurrent accept attempts.
Review and resolve any duplicate active driver assignments returned by the first
query before rollout. Fresh database imports now use InnoDB for `drivers`.

Confirm both `drivers` and `ride_history` use InnoDB on the deployed database.
On an isolated staging database with the real schema and wallet fixtures, verify:

- Two approved drivers accept the same request concurrently: one 200, one 409.
- One driver accepts two requests concurrently: one 200, one DRIVER_BUSY conflict.
- A rider cancels while a driver accepts: cancellation cannot be overwritten by acceptance.
- An unrelated account cannot cancel; the actual rider and assigned driver can.
- A dual-role account can cancel its rider booking but cannot accept that same booking.
- Failed transactions leave no assignment or acceptance notification behind.

Keep the existing single MySQL primary for these writes. This implementation does
not add request idempotency, reliable event replay, or guards for other lifecycle
transitions; those are separate follow-up changes.

## Nearby dispatch rollout

Deploy the backend together with the updated driver app. New driver builds send
fresh GPS presence every 10 seconds while finding rides and mark the socket offline
when leaving search. Older builds do not send this heartbeat and will become stale.
Apply `db/migrations/add_dispatch_radius.sql` once before deploying database-configured dispatch.

Settings (optional environment variables):
- Radius comes from `sysconfigsetup.dispatch_radius_km` on configuration row `SCS_ID_Pk = 1`. The migration initializes 5 km. Updates apply on subsequent dispatch/list/accept requests without restarting; a missing or invalid setting fails instead of silently using a fallback radius.
- `DRIVER_PRESENCE_TTL_SECONDS`: defaults to 45 seconds, maximum 300 seconds.

The approved vehicle category, active status and `Is_Available = 1` come from the
driver record. Online presence comes from an authenticated, connected driver socket.
Freshness uses server receipt time; GPS is still device supplied, not proof against
GPS spoofing. These changes support foreground search. Background/locked-phone
location reliability remains a separate milestone.

Dispatch tests cover GPS validation, TTL, range/category rules, filtered recipients,
online/offline races, HTTP list eligibility, and acceptance checks, using stubbed
DB/socket providers. Before rollout, use real devices and staging MySQL to check a
nearby mini, nearby bike, distant mini, pending driver, busy driver and disconnected
driver. Only the eligible nearby driver should receive the matching request.

## Staged search rollout

Apply `db/migrations/add_dispatch_min_radius.sql` once after the previous maximum
radius migration, before restarting the updated backend. Update both rider and
driver builds together with the backend.

Configuration table: `sysconfigsetup`, row `SCS_ID_Pk = 1`:
- `dispatch_min_radius_km`: first search radius (default 1 km).
- `dispatch_radius_km`: maximum search radius (existing field, default 5 km).

The backend expands by 1 km every 10 seconds and caps the final stage at the exact
maximum. With min 1/max 5, stages begin at 0/10/20/30/40 seconds and expire at 50
seconds if nobody accepts. Equal bounds give one 10-second stage. Minimum must be
positive and cannot exceed maximum. Bounds are re-read for subsequent operations;
changing them also affects already-running searches.

MySQL CreatedAt/NOW determines elapsed time. The backend worker revisits requested
rides in batches of 100, expanding notifications and conditionally closing expired
requests as System cancellations with reason `NO_DRIVER_AVAILABLE`. This is durable
across process restarts; already-old Requested rides also expire on rollout. The
rider receives a socket event and polls the authenticated search-status API as a
fallback. A server/DB outage delays result delivery but does not extend acceptance
past the deadline once requests reach the backend. The worker's batch cycle may
make notification/cleanup timing later than exact stage boundaries under load.

Staging checks: verify a driver outside the initial radius receives nothing until
the appropriate stage; a final-radius driver gets the full final stage; no driver
acceptance results in No driver available and removed cards; acceptance/cancellation
stops expansion; app/background/restart recovery preserves the result. Automated
tests use controlled ages and stub DB/socket providers, not a real-device load test.
