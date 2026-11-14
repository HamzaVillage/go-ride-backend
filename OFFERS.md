# Normal ride offers

This feature covers normal ride booking and settlement. City-to-city has a separate payment flow and is not included.

## Rollout

Back up the database and deploy the updated backend with `OFFERS_ENABLED=false` first. Install storage once from `goRide-Backend`:

```sh
npm run setup:offers
npm run setup:offers -- --apply
```

The first command only checks prerequisites. The apply command creates `promotions`, `ride_promotions`, and `promotion_audit`, registers the Offers employee permission, and adds nullable/defaulted offer fields to `ride_history`. It does not change historical fares or existing wallet balances. All account, ride and wallet tables must use InnoDB. MySQL DDL commits implicitly; keep the backup and rerun the idempotent installer if installation is interrupted.

Deploy the updated admin build and mobile app before setting `OFFERS_ENABLED=true` and restarting the backend. Older mobile versions do not display discounted payable amounts reliably; enforce the updated app release before launching a rider campaign. Keep the quote endpoint deployed even while the feature is disabled; updated clients use it to confirm the full fare too.

Set the backend `GOOGLE_MAPS_API_KEY` with Directions API access. Rider subsidies are limited to the server-verified route fare; an unavailable route provider blocks a discounted booking with a retry message rather than trusting a client-supplied subsidy. No Google call is required if there is no eligible rider offer. Driver fee waivers do not require Maps verification.

Super admins receive Offers access; grant employees the `offers` permission explicitly. Create an initially paused campaign, review its quota/dates, and activate it from Offers. Dates shown/entered in admin are Pakistan time (UTC+05:00); the backend stores UTC epoch milliseconds. The end instant is exclusive.

## Quotas and lifecycle

- Rider offers apply one percentage discount per ride, optionally capped in PKR. The best eligible benefit wins; rider offers do not stack.
- Driver offers waive the complete platform fee for N completed normal rides. Minimum prepaid balance is bypassed automatically while eligible; a negative existing balance and account restrictions remain enforced. There is no independent bypass switch.
- `next_rides` grants each account N benefits within this specific campaign. Closing it and creating a new campaign grants a fresh quota. Editing, pausing or resuming the same campaign preserves usage.
- `first_rides` applies only within the account's first N completed normal rides. Creating a new campaign does not reset lifetime ride history.
- Rider quota reserves at booking; driver quota reserves at acceptance. Canceled/unavailable rides stop counting. Only completed rides permanently consume quota. Account identity is the linked personal user, rather than a device or franchise.
- Campaign row locks and READ COMMITTED transactions serialize last-quota reservations. Existing reserved ride terms remain frozen if the campaign is paused, closed, edited or expires. The final reserved driver ride remains commission-free and retains the top-up bypass until it finishes. The next ride uses normal fees unless another offer is available.
- Closed campaigns cannot reopen. Audience and count basis cannot change on edit. New creation requests retain an idempotency key across refresh/retry, and edits use a version check.
- One rider discount and one driver waiver may apply together. There are no automated refund/reversal or fraudulent-account detection flows added by this change. Any later financial reversal must reverse its associated subsidy/commission ledger entries in the existing settlement transaction.

## Money example

Gross fare PKR 500, rider discount PKR 150, platform fee PKR 15:

| Payment | Rider pays | Driver wallet | Driver earnings |
| --- | ---: | --- | ---: |
| Cash | 350 cash | +150 subsidy, -15 fee | 485 |
| Wallet | 350 wallet debit | +500 gross credit, -15 fee | 485 |
| Cash + driver waiver | 350 cash | +150 subsidy, no fee debit | 500 |
| Wallet + driver waiver | 350 wallet debit | +500 gross credit, no fee debit | 500 |

Wallet payments already credit the full gross fare to the driver, so they receive no second subsidy credit. A 100% rider discount creates no zero-value rider debit. If the existing wallet-payment fallback changes a ride to cash for insufficient funds, the discounted payable and cash subsidy still apply.

The stored agreed gross fare remains `Fare`; `Rider_Discount` and `Customer_Payable` describe the rider's payment. Existing platform fixed/percentage configuration determines the saved fee, unless a driver waiver makes it zero. A voluntary fare increase cannot increase subsidy beyond the route ceiling frozen at booking. All settlement entries, redemption consumption, driver earnings and completed ride status commit or roll back together.

Turning off the feature stops new reservations. Financial promises already attached to rides are honored at completion. Keep storage installed; do not drop tables or zero offer fields to disable campaigns.

## Verification limits

Automated checks use mocked database/API fixtures, including parallel final-quota reservations, discount settlement, audit rollback, migration safety, and browser create/retry/edit flows. They do not prove a production MySQL migration or a real money transaction. Run a staging ride with test accounts on the deployed schema, then verify cash collection, both wallets, and the first charged ride after the driver quota expires before enabling a live campaign.

Latest local verification: 365 backend tests passed (one existing skip); 103 mobile tests passed across 24 focused suites; 16 admin unit tests and three mocked offer browser flows passed. Admin production build and both iOS/Android production JavaScript bundles passed. The existing top-level RN `App.test.tsx` smoke test has an unrelated navigation ESM setup failure, so it is excluded from that mobile count. Focused lint still reports the pre-existing `RideRequestCard` countdown effect dependency error and style/unused-variable warnings. Native app builds, device rendering, staging MySQL, and live payment-provider checks were not performed for this feature.
