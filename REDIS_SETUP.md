# Redis and nearby map rollout

Use Node.js 20+ and a private Redis server version 6.2 or newer. Install backend
packages with `npm ci` and configure the backend environment:

```dotenv
REDIS_URL=redis://127.0.0.1:6379
REDIS_KEY_PREFIX=goride:
```

Use the provider's `rediss://` URL with authentication when TLS is required. Keep
Redis private and use a separate key prefix per deployment/database. Restart the
backend after changing REDIS_URL. A successful connection logs `Redis cache connected`.
This change does not install or configure Redis on the production server.

Deploy the updated rider and driver apps along with the backend. No new SQL
migration is required for this milestone; the earlier dispatch radius migrations
remain required. The tracked backend entry point is `Server.js` (capital S); on
case-sensitive hosts run `node Server.js` with your process manager.

## What is cached

- Driver GPS/session presence uses Redis GEO indexes and expiring per-session
  metadata (45 seconds by default, controlled by DRIVER_PRESENCE_TTL_SECONDS).
  Heartbeats run every ~3 seconds while the driver searches in the foreground;
  stationary devices also refresh through the existing periodic location check.
- Dispatch bounds and the public app config cache for 5 seconds. Changes made
  directly in phpMyAdmin can therefore take up to 5 seconds to appear.
- Bulk driver eligibility snapshots cache for 5 seconds; active vehicle types for
  30 seconds. Warm nearby-map cache hits borrow no MySQL connection.
- Accepted drivers are removed from public presence, and offline/disconnect removes
  presence. TTL removes abandoned sessions. The map returns up to 30 anonymous,
  approximately positioned available drivers; it returns no names, phone numbers,
  profile photos or user IDs. Assigned ride tracking remains separate.

MySQL remains authoritative for ride acceptance locks, ownership, status transitions
and financial records. GPS cache writes make no database writes. Nearby ride-list
polling and the durable search worker still query MySQL; this is not a full removal
of database reads. Redis is a cache, not a replacement for those consistency checks.

Redis commands have bounded timeouts, no offline command queue, and a short circuit
breaker. Missing/unavailable Redis falls back to connected socket presence and DB
reads. Cache contents may be discarded. Redis capacity/eviction and fallback load
must be tested against your expected concurrent users.

This integrates Redis caching/GEO presence, not the Socket.IO Redis adapter. Add a
shared Socket.IO adapter and proper load-balancer routing before running multiple
backend instances; Redis GEO alone does not deliver events across instances.

## Verification

```sh
npm test
RUN_REDIS_INTEGRATION=1 node --test tests/redis-cache.integration.test.js
```

The opt-in integration test needs `redis-server` on PATH and starts an isolated,
temporary instance over a Unix socket. It verifies real cache hits, concurrent miss
coalescing, TTL expiry, GEO search, offline cleanup and disconnected fallback.

From the app directory, run:

```sh
npm test -- --watchman=false --runInBand __tests__/MapMotion.test.tsx
```

These marker tests use native-map doubles. Before release, verify both Android and
iOS release builds on real devices: first-location visibility, movement/rotation,
stationary jitter, offline/busy removal, app focus/background cleanup and Redis
outage. This work does not claim measured frame rate, native build success or
reliable background location service support.
