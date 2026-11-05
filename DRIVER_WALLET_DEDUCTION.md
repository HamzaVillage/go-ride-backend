# Full fare deduction on ride completion

A newly completed ride posts one `completed` debit to `driver_wallet`, using the
assigned `drivers.id` (not the customer's or driver's users table ID). The amount
is the stored full `ride_history.Fare`, not the organization fee. The reference is
`RIDE_DEBIT_<rideId>`, with payment method `other` for compatibility with older
wallet enums.

For a cash ride: starting credit 1000, fare 500 -> balance 500. Another 500 fare
leaves 0. The existing vehicle minimum remains authoritative: if it is 300, a
balance of 200 already requires top-up. A currently started trip can complete even
if its fare takes the wallet negative; subsequent online/accept checks require
funding before finding another ride.

The driver wallet balance now comes exclusively from completed driver ledger
credits minus completed debits. It never falls back to a separate customer
`user_wallets` balance when depleted. Existing funds in customer wallets are not
transferred or removed. Driver prepaid top-ups must credit `driver_wallet`; the
future merchant top-up integration must target that ledger for driver funding.

Existing customer-wallet payment settlement is preserved: a wallet-paid ride
charges the customer's wallet and credits the driver's net digital earning, then
posts the full-fare driver debit. Example with a 50 organization fee: driver starts
at 1000, receives 450 digital earning credit, then is charged 500 -> net balance
950. Cash rides have no such earning credit. Earnings reports continue to show fare
minus organization fee; no extra commission debit is introduced.

Ride completion, full-fare debit, customer-wallet settlement (if applicable),
earnings, driver counters and active-chat deletion now share one transaction. Any
failure rolls back the whole operation. Ride and assigned-driver row locks protect
concurrent completion; retries return the recorded result without duplicate charges,
earnings or completion pushes. Previously completed rides are not retroactively
charged or backfilled.

The completion response includes `driver_wallet_deduction`, `wallet_balance`,
`min_wallet_balance`, `is_wallet_sufficient` and `topup_required`. The updated driver
screen refreshes its balance immediately and shows the existing top-up prompt when
needed; the server also sends `driver:wallet_updated` to the acting driver's user
room. Online/accept wallet checks use the same ledger calculation.

No new SQL migration is required for this change. The existing `drivers`,
`ride_history`, `driver_wallet` and other financial tables must use InnoDB for atomic
settlement. Apply the earlier engine migration if still pending. Test against an
isolated database before production rollout. Automated wallet tests use transactional
DB doubles; no production ride was completed and no live funds were deducted.
