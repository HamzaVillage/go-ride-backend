# Admin drivers and manual wallet top-ups

All endpoints require an unexpired HS256 JWT issued by `/auth/admin-login`, with `role: "admin"` and the authenticated `userId`. API keys, rider/driver tokens, and superadmin tokens are not accepted for these endpoints. Top-ups also verify that the acting admin still exists and is not deleted. Responses use `Cache-Control: no-store, private`.

## Browse every driver

`GET /admin/drivers?page=1&limit=20&q=&status=all&online=all`

- `page`: positive integer, default 1.
- `limit`: 1–100, default 20. Use pagination to browse the entire driver population.
- `q`: up to 100 characters; searches name, phone, email, city, plate, canonical `GRD-` code, or exact driver ID. SQL wildcard characters are escaped.
- `status`: `all`, `unverified`, `pending`, `active`, `inactive`, `blocked`.
- `online`: `all`, `online`, `offline`.

Returns `{ success: true, data: { drivers: [...], pagination: { page, limit, total, totalPages } } }`. Drivers include contact/vehicle information, account status, online state, rating, and the balance of completed credits minus completed debits in `driver_wallet`. The list also includes CNIC and document-presence indicators for the detailed admin view. Passwords, hashes, raw identity-document paths, FCM tokens, and payment-account details are excluded. See `ADMIN_DRIVER_PROFILES.md` for profile editing and authenticated document viewing.

## Wallet and history

`GET /admin/drivers/:driverId/wallet?page=1&limit=10`

Returns `{ success: true, data: { driver, transactions, pagination } }`. History includes amount, credit/debit type, status, payment method, note/description, reference, timestamp, and recorded actor ID. Missing drivers return 404.

## Manual top-up

`POST /admin/drivers/:driverId/topups`

Headers:

```text
Authorization: Bearer <admin-login-token>
Idempotency-Key: <new UUID v4 for this particular intended credit>
Content-Type: application/json
```

Body:

```json
{
  "amount": "1000.50",
  "payment_method": "bank_transfer",
  "note": "Receipt or payment reference"
}
```

The amount is PKR, between 0.01 and 99,999,999.99, with at most two decimal places. Methods: `cash`, `bank_transfer`, `easypaisa`, `jazzcash`, `other`. Note is optional and limited to 500 characters. This endpoint **records a manual wallet credit** after the admin verifies payment; it does not initiate a bank/mobile payment.

The credit is written to the existing `driver_wallet` ledger with `transaction_type = credit`, `status = completed`, `created_by` derived from the authenticated admin, and an `ADMIN_TOPUP_<uuid>` reference. It does not update rider wallets, overwrite driver balances, reset earnings, or change approval/online state.

The admin account and driver are checked within the transaction. A driver row lock serializes concurrent top-ups. Repeating a request with the same driver, key, amount, method, note, and admin returns the original transaction without adding a credit. Reusing a key with different details returns 409. Failed transactions roll back. If the response is lost, **retry the same key and body**.

Success data:

```json
{
  "driver_id": 10,
  "transaction_id": 99,
  "reference_id": "ADMIN_TOPUP_<uuid>",
  "credited_amount": 1000.50,
  "wallet_balance": 1500.50,
  "already_applied": false
}
```

The panel saves an unconfirmed request key/body in sessionStorage scoped to admin and driver before submitting. After a timeout or refresh, opening that driver's wallet offers **Retry same top-up**; confirmed requests are cleared. Top-up success immediately invalidates the driver list and wallet caches so balances/history refresh without reloading. Driver lists and open wallets also refresh every 15 seconds while the tab is active.

No schema migration is needed for the inspected database. Automated credits are tested only against isolated fixtures; real driver balances are not changed during verification.
