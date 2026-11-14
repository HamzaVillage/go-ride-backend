# Platform fee deduction on ride completion

Normal ride completion debits only `ride_history.Organization_Fee` from the driver's prepaid wallet. It never debits the entire ride fare. The stored fee is authoritative for rides already booked: changing vehicle settings affects new bookings, not an in-progress ride or historical completion.

## Fee mode in Vehicle fares

Each vehicle has a mutually exclusive selector beside its Platform fee heading:

- `Platform_Fee_Is_Percentage = 1`: use `Fee_Percentage`; ignore `Platform_Fee_RS`.
- `Platform_Fee_Is_Percentage = 0`: use the exact `Platform_Fee_RS`; ignore `Fee_Percentage`.

The inactive value is retained for switching back later. The default is percentage, preserving current passenger fare calculations. Percentage is added to the underlying fare, not taken as a percentage of the fee-inclusive total: a PKR 300 underlying fare with 10% fee quotes PKR 330; the included platform fee is PKR 30. For an agreed/adjusted fee-inclusive fare, the saved percentage fee is `total - total/(1 + percent/100)`, rounded to paisa. Fixed mode adds the selected fixed fee before the existing fare rounding and saves that exact fixed amount at booking. Existing quote rounding can cause a small difference between the pre-rounding estimated percentage breakdown and the fee extracted from an agreed rounded booking total; the saved booking amount controls settlement.

The admin selector and fixed-fee edits are disabled until schema support is installed; ordinary existing percentage/base-price edits remain available. Setup is explicit, never automatic at API startup:

```bash
npm run setup:platform-fees
npm run setup:platform-fees -- --apply
```

The first command checks schema without changes. The second adds missing `Platform_Fee_Is_Percentage TINYINT(1) NOT NULL DEFAULT 1` and, only if absent, `Platform_Fee_RS DECIMAL(10,2) NOT NULL DEFAULT 0` columns to `vehicle_fare_rate`. It preserves existing rates, fixed-fee values, ride history and wallet ledgers. Deploy the backend and admin panel together. No production migration or balance change is performed during development.

## Settlement examples

For a stored PKR 500 fare and PKR 50 fee with a starting driver balance of PKR 1000:

- Cash: customer pays driver PKR 500 directly; driver wallet receives one PKR 50 debit and ends at PKR 950. Driver earnings are PKR 450.
- Customer wallet: customer wallet pays PKR 500; driver wallet receives a PKR 500 credit and one PKR 50 platform fee debit, ending at PKR 1450. Net driver earnings are PKR 450.
- Insufficient customer wallet: existing cash fallback remains; driver wallet is charged only the platform fee.
- Zero platform fee: no driver debit is inserted.

Fees greater than the fare or invalid/negative amounts fail settlement. Ride completion, payment settlement, earnings, counters and chat deletion share one transaction. Locks and the existing `RIDE_DEBIT_<rideId>` reference prevent duplicate deductions. An already-completed ride returns its original recorded deduction, including older full-fare debits; this change neither recharges nor refunds historical rides.

Wallet balance uses completed driver credits minus completed debits, never the customer's wallet as a fallback. Existing minimum-balance checks and `driver:wallet_updated` notifications remain. Automated tests use database doubles only and never complete live rides or modify real balances. City-to-city service commissions remain in their separate existing flow.

## Legacy dues retired

The eight-hour ride-count dues system no longer starts a timer, treats accumulated driver earnings as debt, or restricts online presence, nearby rides, matching or dispatch. Profile and earnings responses keep `overdue_info: null` for older client compatibility. The old authenticated clear-overdue endpoint is a no-op and never resets earnings or ride totals. Existing stored overdue timestamps are ignored; no migration, balance reset or historical ledger rewrite is needed. Minimum-wallet eligibility and the configured platform-fee settlement continue to apply, including active driver offer waivers. Deploy the updated backend and mobile app; restart the backend after uploading the changes.
