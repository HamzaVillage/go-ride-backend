# API and dispatch reliability review — 2026-11-04

Scope: source review of ride creation/search/dispatch, lifecycle, completion/reviews, socket authorization, authentication routes and server/database configuration. This is a targeted code review, not certification of every endpoint or a 100k-user load test. No production records or funds were changed.

## Fixed in this change

- Completed-ride recovery now restores the ride ID before showing feedback; review requests use the completed ride's ID as the source.
- Feedback waits for a successful API result before dismissal. Failures retain the screen/input, expose a retry message and permit retry. A synchronous guard prevents double submissions.
- Reviews validate IDs, whole-star ratings, tag arrays and comment length; only the customer or assigned driver can submit. Previously every non-customer was treated as a driver without ownership verification.
- Review and driver-rating updates commit together and roll back on failure. The assigned driver row serializes concurrent average updates.
- Reviews no longer require the optional User_ID_FK audit column. A read-only check confirmed this column DOES exist on the configured database, so a missing column is not established as the observed device failure.
- Removed CREATE TABLE from review and driver-profile requests. `db/migrations/ensure_ride_reviews.sql` prepares new installations; the configured database already has the table. Verify the existing unique key on (Ride_ID_Fk, Reviewer_ID_Fk) before rollout to another installation.
- Late cancellation socket events for a different ride, or after completion, cannot dismiss pending feedback.
- Driver online acknowledgement now triggers an immediate offer refresh. It also queues a refresh if an earlier listing is still in flight, instead of waiting for the next 10-second poll.

## Remaining findings, in priority order

### P0: live ride socket authorization

`socket/socketManager.js:283` accepts client-supplied rideId for location broadcasts without checking assigned-driver ownership. `:305` allows any authenticated account to join an arbitrary ride room. JWT authentication alone does not authorize access to that ride. Consequences: live event/location disclosure and spoofed location updates. Chat uses separate authorized rooms, so this finding concerns ride events/location, not chat history. Add database-verified participant membership and assigned-driver checks, including leave/disconnect/reassignment cleanup. Test cross-account joins and forged updates.

### P0: overdue can be cleared without a verified settlement

`controller/rideController.js` clearOverdue resets overdue and counters for any authenticated driver calling that endpoint; it does not verify an actual payment or an approved administrative settlement. A driver can bypass that blocking rule. Replace it with a verified settlement or authenticated administrative workflow; do not implement a payment provider until the merchant integration is ready.

### P0: production authentication configuration and OTP controls

Auth middleware, Socket.IO and token creation accept hardcoded fallback signing credentials. Legacy admin middleware also permits a fallback API key. Auth controller includes static reviewer OTP paths and logs received/stored OTPs. Auth routes do not install a rate limiter; failed OTP attempts are incremented but the inspected verification path does not enforce a lockout before comparison. Require configured production secrets, explicitly gate test accounts, remove OTP logs, enforce attempt limits and apply per-phone/IP throttling. Do not abruptly rotate production secrets without a session rollout plan.

### P1: lifecycle write races

startRide and markArrived check status with SELECT and later UPDATE solely by ride ID. A concurrent cancellation can commit between those statements; the later write can resurrect that cancelled ride as Started/Arrived. Use conditional status/driver updates or transactions with a consistent locking order; return 409 when the expected transition lost the race. Add cancellation-vs-start/arrival concurrency tests.

### P1: ride creation is not protected against concurrent retries

createRide checks for an active customer ride and inserts separately, without a customer lock or idempotency key. Two concurrent creates can both pass the check. Also the API trusts client-supplied fare/distance/rate fields; core fare validation must be server authoritative. Serialize creation for the authenticated customer, add a request idempotency key, validate numeric bounds and use a server-issued quote with an explicit expiry.

### P1: dispatch scaling and late-online drivers

Creation already calls dispatchRide immediately after insert: an eligible connected driver inside the CURRENT radius does not wait for the worker. Stages intentionally expand by 1 km every 10 seconds; a driver 5 km away with a 1–5 km configuration becomes eligible at about 40 seconds, not at creation.

The worker processes only 100 searches then sleeps 2 seconds. With 5,000 pending searches, a full pass takes at least about 100 seconds, excluding database/dispatch time. This can exceed the default 50-second search lifetime. dispatchRide fetches every socket in a vehicle room for every ride. Worker delivery happens on radius changes, so drivers who come online between stages rely on their immediate/periodic listing to discover existing offers. Replace the scan with a scheduled/durable dispatch queue, bounded indexed GEO candidate lookup, delivery acknowledgements/replay and measured queue latency. Preserve radius eligibility and first-accept protection.

### P1: Redis cache does not make Socket.IO multi-server

Redis caches GEO/presence/config/eligibility, but the server has no shared Socket.IO adapter configured. With multiple backend processes, HTTP creation may occur on a process that cannot see the driver's socket. A shared adapter and an elected/shared search-worker strategy are both required before horizontal scaling. Depending on transport, configure load-balancer session affinity as documented.

Socket.IO's default delivery is at most once; emit success does not prove that a device received or displayed an offer. Keep polling/recovery and add durable event IDs/acknowledgements if reliable replay is required. References:
- https://socket.io/docs/v4/redis-adapter/
- https://socket.io/docs/v4/delivery-guarantees/

### P1: database backpressure and indexing

`db/Connect_Db.js` uses 10 connections with unlimited queueing. Per-driver listing every 10 seconds means 10,000 HTTP requests/second if 100,000 drivers are simultaneously searching, before other traffic. This is arithmetic, not a measured capacity claim; registered users and concurrent drivers are different workloads. Avoid simply raising the pool limit. Bound queue/wait times, reduce redundant polling and measure DB saturation. Verify deployed composite indexes using SHOW INDEX/EXPLAIN for customer/status, driver/status, pending-search status/ID/CreatedAt and reviewee/role. Inspect existing indexes before adding replacements.

### P2: misleading recovery and UI state

getActiveRide returns completed/cancelled rides from the past five minutes. Previously completed recovery omitted the ID (fixed). It can still re-offer feedback after an already-submitted review or skipped screen because no durable feedback acknowledgement is tracked. Filter completed results with review existence or record acknowledgement. A delayed Android cancellation push can also remain in the notification tray after a later ride; the UI socket guard does not retract old operating-system notifications.

### P2: request limits and observability

Server accepts JSON and urlencoded bodies up to 50 MB globally. No general request limiter or structured request-ID/latency instrumentation was found in the inspected startup path. Use route-specific body limits, structured redacted logs, request IDs, timeout/error metrics and an explicit health/readiness check. Inventory public endpoints and payment callback verification separately; payment-provider readiness remains outside this review's tested scope.

## Validation needed before claiming capacity

Run staging load tests with an explicit workload: concurrent drivers, customer searches/second, GPS updates/second, active rides and reconnect churn. Measure p50/p95/p99 create-to-driver-display latency, worker delay, database queue/lock time, Socket.IO delivery misses and HTTP error rates. Include restarts, Redis outage, slow GPS, duplicate requests and concurrent acceptance/cancellation/completion. Unit tests prove the covered rules, not production throughput or zero bugs.

The production review request's HTTP status/body was not captured in this task. The restored-ID and swallowed-failure bugs are reproduced in tests; after deployment capture the response if the device still fails. Schema inspection was read-only. Native/device execution and a real review write were not performed.
