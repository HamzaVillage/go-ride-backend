> Staff identities now live only in `employee`. The independent-staff upgrade and current authentication contract are documented in [staff identities](docs/staff-identities.md); that document supersedes legacy users-based setup below.

# Admin sign-in

`POST /auth/admin-login`

```json
{
  "email": "admin@example.com",
  "password": "the-existing-admin-password",
  "security_code": "0000"
}
```

The code is a **string of exactly four digits**, permanently `0000`, as requested. It is not an OTP or an independent security factor. No SMS or email code is sent. Never prefill it in the panel.

The account must already exist in `users` with `Role = 'admin'`, `AccountDeleted = 0` (or NULL for legacy active accounts), and a bcrypt hash in `Password`. Email is trimmed and case-normalized; the existing users table uses a case-insensitive email collation. Ambiguous duplicate admin emails fail closed. The endpoint does not register accounts or change roles. The panel accepts only returned profiles with `role: 'admin'`.

Set a strong `JWT_SECRET` in the server environment, or run `npm run setup:admin-auth` from the backend directory to generate a random private key in its ignored `.env` file. The setup command preserves an already configured key and never prints its value. Restart the backend after generating it. The server loads `.env` relative to its own directory, including when started from another working directory. Missing configuration returns 503; this endpoint never signs tokens with the legacy fallback secret. Do not put JWT secrets or admin passwords into VITE variables. Existing API-key authentication for integrations is unchanged, but the panel now signs in through this endpoint.

## Response

```json
{
  "success": true,
  "message": "Admin login successful.",
  "token": "<signed JWT>",
  "expiresAt": 1800000000000,
  "user": {
    "id": 7,
    "name": "Administrator",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

The HS256 JWT contains `userId`, `role: 'admin'`, `iat`, and `exp`, with an eight-hour lifetime. `expiresAt` is Unix time in milliseconds. Use `Authorization: Bearer <token>` for existing protected admin endpoints. Passwords, hashes, and security codes are never returned. Responses set `Cache-Control: no-store, private`.

- 400: malformed or missing email/password/four-digit code.
- 401: invalid credentials/code, non-admin/deleted account, or duplicate admin email (same generic message).
- 429: more than 10 failed attempts per IP in 15 minutes; includes `Retry-After`.
- 503: JWT signing is not configured.
- 500: temporary internal failure, without database internals in the response.

The rate limiter uses per-process memory. A deployment with multiple API instances should use a shared rate-limit store or edge limiter. Behind a reverse proxy, configure Express `trust proxy` for the actual trusted proxy topology; do not trust arbitrary forwarded headers. Customer OTP login excludes privileged admin/superadmin roles so it cannot bypass this form.

No database migrations, account promotions, or production account changes are performed by this implementation. Restart the backend to load the new route.

## Verification

```sh
node --test tests/admin-login.test.js tests/admin-otp-isolation.test.js tests/chat-admin.test.js
```

These tests use stubbed database records, real bcrypt comparison and JWT signing, existing admin middleware, and a local HTTP endpoint for throttling. They do not log into a real production account.
