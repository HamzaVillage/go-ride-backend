# City-to-City wallet

Normal driver/rider wallets, tables, payment screens and settlement are unchanged.

Install: `npm run setup:city-to-city-wallet -- --apply`. This creates only
`city_to_city_wallet` (posted credit/debit ledger) and
`city_to_city_topup_requests` (pending/approved/rejected payment requests).
No opening balances or historical trip charges are imported.

Drivers open **City-to-City wallet** from the City-to-City drawer/map. They select
an approved active service and submit amount, payment method and transaction
reference after transferring to the displayed official deposit account.
`city_to_city_services.minimum_topup_amount` is checked server-side and snapshotted.
Zero means no minimum recharge, not free credit. The ledger balance is shared
across this driver's City-to-City services only.

Admin: **City-to-City → Wallets & top-ups**. Uses the existing
`city_to_city_drivers` screen permission. Payment is manually verified against
bank/provider records before approval; entering a reference is not proof of
payment and no payment gateway is called automatically. Rejection requires a
reason. Approval credits once, records the employee ID, and retains the payment
reference. The same method/reference cannot be submitted again. The existing
normal-driver top-up system is independent, so finance staff must also ensure
that a single deposit has not already been credited there.

Mobile GET/POST `/city-to-city/driver/wallet[/topups]` derive driver ownership from
authenticated identity. Admin list is
`/admin/city-to-city-drivers/wallet-topups`; per-driver summary is `/:id/wallet`
and review is `/:id/topups/:requestId/review` under that admin prefix.

Balances derive from the append-only ledger. All financial writers lock the
City-to-City driver row. Submission keys and credit references are unique;
retries preserve existing decisions without posting another credit.

Acceptance requires balance to cover the request's snapshotted commission.
The one-active-trip rule reserves that capacity logically; no withdrawals or
negative adjustments are exposed. Completion atomically posts the stored
booking platform fee and completes the trip. Cancellation posts no commission.
Cash fares stay with the driver; net cash earnings are displayed separately and
are not credited again. Existing bookings retain stored commission values.
An existing trip accepted before this feature may complete into a negative
balance; its driver must recharge before accepting another chargeable trip.

Read-only live schema/summary checks are permitted in verification; actual
payments, wallet credits and bookings are tested only against fixtures.

## Manual top-ups and required balance

`minimum_required_balance` is a separate service setting, editable in the admin
fare editor. Apply `db/migrations/add_city_to_city_required_balance.sql` on older
databases. It does not change `minimum_topup_amount`.

The current mobile Top Up screen reuses the normal driver's bank/QR/support
layout with the City-to-City identity and CTC code. Drivers copy that code and
provide their payment proof through the existing support process. The mobile
request form is no longer shown; older pending requests remain reviewable.

Admin direct credit is `POST /admin/city-to-city-drivers/:id/topups` with a UUID v4
`Idempotency-Key`, amount, payment method and unique payment reference. It creates
an approved audit request and ledger credit in the same transaction. General
wallet recharge uses the lowest minimum top-up among approved active services.
The admin UI persists uncertain credit details and their key across refreshes.

A zero/negative balance blocks all searching even if configured thresholds are
zero. Positive balances enable only approved active services whose required
balance is met. Presence, feed and acceptance enforce this server-side. Acceptance
also retains the commission-coverage check. Existing active trips can still be
completed. Mobile checks eligibility before GPS/search and polls again to resume
when an admin credit brings the balance above the applicable requirement.
