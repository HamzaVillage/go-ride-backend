# City-to-city driver onboarding

City-to-city driver profiles belong to the existing `users` identity. Registration
never creates or updates a city `drivers` row, never changes `users.Role`, and never
changes a city ride. The mobile session keeps city-to-city profile data separately
from the current rider/city-driver profile.

## Database rollout

Use the existing city-to-city foundation migration first. For databases using the
original ten-table version, import the updated `add_city_to_city.sql`, then run
`upgrade_city_to_city_dynamic_services.sql` once, as documented in those files.

For this feature, import `db/migrations/add_city_to_city_onboarding.sql` before
restarting the updated backend. It adds personal/onboarding columns to
`city_to_city_drivers` and is safe to rerun on MariaDB 10.5. Fresh installations of
the updated foundation already include these columns. Existing `city` directory
rows and the three seeded `city_to_city_services` must exist for form options.

No migration or production data change is performed automatically at startup.

For existing installations, also run
`db/migrations/add_city_to_city_existing_driver_enrollment.sql` after onboarding
and before deploying this version. It adds document provenance and imported
application metadata, and allows an unresolved home city while pending. The
updated foundation includes these fields for fresh installations.

## Mobile entry points

- Signup selection: **Sign Up as a City to City Driver** creates/verifies the
  personal account with the existing account signup/OTP flow, then opens the
  independent city-to-city application.
- Existing riders/city drivers: both **Become a City to City Driver** and
  **City to City driver mode** check enrollment. Missing enrollment shows a
  confirmation first. Riders then open the full form; an existing city driver
  can reuse their stored details/documents in one confirmed submission.
- Login page: **City to City Driver? Login here** uses dedicated OTP endpoints.
  Existing applicants can inspect pending/rejected/suspended status after login.
- City-to-city drawer: application, support, rider mode, and city-driver mode.
  Returning to city-driver mode requires the existing approved city-driver profile.

The form follows the existing three-step driver design: personal information,
vehicle/services, then payout details/documents. Vehicles use their own categories
and record passenger capacity excluding the driver. Parcel capability additionally
requires a weight capacity. Phone/email identity comes from the authenticated
account, not registration ownership fields submitted by a client.

Applications start pending; an admin must approve independently of city driving.
Rejected applications can be edited and resubmitted. Pending retries return the
existing application. Approved or suspended applications cannot be overwritten by
registration. Document uploads are optional for initial review, but all five
unexpired photo/identity/licence/vehicle document records are required to approve.
Identity files use the existing private driver document store; photos follow the
existing photo storage convention. Each upload is limited to 8 MB.

## API

Public, with rate limiting:

- `POST /city-to-city/auth/send-otp` `{ phone }`
- `POST /city-to-city/auth/verify-otp` `{ phone, otp }`

OTP records have purpose `city_to_city_login`, a hash, a ten-minute expiry, a
one-minute resend cooldown, and at most five verification attempts. Codes are not
returned to the client. The existing SMS provider and configured `JWT_SECRET` are
required. Login returns a personal-account token and never grants city-driver
approval. A city ride in progress blocks entry to the separate mode.

Authenticated personal-account routes:

- `GET /city-to-city/driver/options`
- `GET /city-to-city/driver/account`
- `POST /city-to-city/driver/register` (multipart form)
- `POST /city-to-city/driver/enroll-existing` (no client identity fields)
- `POST /city-to-city/driver/switch` `{ mode: rider | driver | city_to_city_driver }`
- `GET /city-to-city/driver/documents/:id` (owner-only)

Registration fields: `Name`, `FatherName`, `Cnic`, `DOB` (`YYYY-MM-DD`), `Address`,
`Home_City_ID`, `Vehicle_Type`, `Vehicle_Make`, `Vehicle_Model`, `Manufacture_Year`,
`Vehicle_Number`, `Vehicle_Color`, `Passenger_Capacity`, `Max_Parcel_Weight_Kg`,
`Services` (JSON array of service codes), `EasyPaisa`, `JazzCash`.
File fields: `Photo`, `CNIC_Front`, `CNIC_Back`, `License`, `Vehicle_Running_Page`.

Switching is checked on the server for active city rides and boarding/in-progress
city-to-city driver trips. A submitted application is retained if a subsequent
mode switch is blocked. City-to-city status refreshes while its dashboard is
focused and the app is active, including on foreground/resume.

Admin routes require the existing `drivers` management grant:

- `GET /admin/city-to-city-drivers?status=pending&page=1`
- `GET /admin/city-to-city-drivers/:id`
- `GET /admin/city-to-city-drivers/:id/documents/:documentId`
- `PATCH /admin/city-to-city-drivers/:id/status`
  `{ status: approved | rejected | suspended, expected_status, reason }`
- `PATCH /admin/city-to-city-drivers/:id/imported-details`
  accepts the registration metadata fields to complete an imported application.

Existing-driver enrollment locks the canonical personal account, returns an
existing application on retries, and copies references to existing documents
without uploading or moving files. It records the source driver/document keys;
approval never inherits from the city driver. All imported applications start
pending, offline, with service permissions disabled. The older city-driver
schema lacks make/year/seat metadata, so admin completes those real values before
approval; the backend does not invent them. Missing required documents still
block approval. Completing metadata keeps the application pending.

Legacy session identity recovery is limited to a unique canonical account with
the verified JWT phone. Missing, ambiguous, deleted or privileged accounts receive
an explicit authentication/account error; request-body phone fields cannot select
another enrollment owner.

The mobile app now shares English/Urdu preferences across rider, city-driver and
city-to-city modes. Language settings are available from login and account
settings. Urdu changes presentation direction and app labels without remounting
ride state or changing typed addresses, chat content, identifiers or API values.

The new admin page is `/drivers/city-to-city`. Approval changes the separate
profile, selected service permissions, active vehicle and required document review
states atomically, recording the authenticated reviewer. Reject/suspend require a
reason. Active city-to-city driver trips block review changes. No city driver
approval, fare, wallet, ride booking or dispatch code is changed by this feature.

City-to-city trip creation, matching, online presence, earnings and settlement are
separate future work. The new dashboard intentionally does not enter city ride
dispatch or expose city wallet balances as city-to-city earnings.

## Vehicle capacity before enrollment

The mobile switch now collects passenger seats (excluding the driver, 1–30) and
parcel capacity in kg (positive, at most two decimal places) before enrollment.
New riders continue to the full application with these values prefilled. Existing
city drivers submit these two values to `POST /city-to-city/driver/enroll-existing`;
all identity/document references and vehicle model/plate/color are reused. This
creates the city-to-city vehicle in the same transaction, attaches the reused
registration document, and keeps application/services pending and offline.

`POST /city-to-city/driver/capacity` accepts the same fields for an existing
application missing capacity. It uses the authenticated owner, blocks active
city-to-city trips, and resets vehicle/profile approval and service enablement for
admin review. Switching returns `needs_capacity` when this information is missing.
Completed applications are not asked these questions again on every switch.

Apply `db/migrations/optional_city_to_city_vehicle_metadata.sql` before this
version. The ordinary driver signup does not collect vehicle make/manufacture year;
these are now nullable and removed from mobile/admin forms. Existing known values
are preserved. City-driver signup and ride dispatch remain unchanged.

## A city bike/rickshaw driver registering a car

City-driver identity and vehicle records remain unchanged. Options return a limited
`existing_vehicle` preview and `requires_new_vehicle`; an existing application also
returns its own eligibility flag. A Bike/Auto/Rickshaw is never relabelled as a car
based on its model name. The app collects a separate car instead.

The enroll-existing and capacity endpoints now support JSON for unchanged cars or
multipart for a separate car. Multipart fields are `New_Vehicle=1`, `Vehicle_Type`,
`Vehicle_Model`, `Vehicle_Number`, `Vehicle_Color`, `Passenger_Capacity` and
`Max_Parcel_Weight_Kg`, plus a required `Vehicle_Running_Page` file (up to 8 MB).
Make/year remain optional and are not requested. The backend validates vehicle
eligibility and file signatures, not merely filename extensions.

Personal identity/license document references are reused. The original city
vehicle registration is excluded when enrolling a new car. The uploaded car file
is stored privately and referenced by `city_to_city_driver_documents` with both
`city_to_city_driver_id` and the separate car's `vehicle_id`. Registration uploads
start pending. Replacing an existing city-to-city car deactivates its previous
city-to-city vehicle and resets approval; it does not update any `drivers` column.

Admin previews show registration documents for active city-to-city vehicles.
Orphan registration files from a bike snapshot cannot be auto-attached to a car.
The administrator must independently verify the car document and driving licence
eligibility before approval. Real document submission/approval is not part of
automated verification; tests use fixtures.

## Current-city request dispatch

Deploy the updated backend/mobile together. Before using dispatch, apply
`db/migrations/add_city_to_city_dispatch.sql` and privately configure the backend
`GOOGLE_MAPS_API_KEY` for Geocoding and Directions APIs. These setup changes are
explicit, not automatically run on startup. Location lookup fails closed if the
key, supported city or map-provider response is unavailable. No city is guessed
from a home profile, address substring, nearest-city radius or a client city ID.

Approved drivers enter the searching dashboard automatically. Foreground GPS
presence updates about every 30 seconds, resolves the current locality against
`city`, and expires after 90 seconds without a heartbeat. Requests poll every four
seconds while the app is active. This first implementation uses polling rather
than instant socket/push dispatch. Drivers may go offline. Switching out of the
city-to-city mode sets that profile offline. Existing in-city dispatch and its
radius settings are unchanged.

Rider pickup/destination coordinates are reverse-geocoded server-side. A request
must cross two supported cities. Shared/private requests require a passenger
count; parcels require kg, description and recipient name/phone. Server route
quotes use configured active service tariffs or currently valid route overrides.
Shared fare is multiplied by persons. Where pricing is disabled, the rider must
enter a positive total offer; the app never invents a tariff. Fare, commission and
currency are snapshotted at creation. Payment method is cash; this implementation
does not debit wallets or post earnings/settlement ledger entries.

Eligibility uses an exact origin-city ID match to fresh current-city presence,
approved driver/service/vehicle, and enough seats or parcel kg. No KM/proximity
filter is applied to city-to-city matching. Customer phone details are exposed to
the assigned driver only after acceptance. Requests are customer-scoped. Active
city rides, city-to-city trips and customer bookings block conflicting acceptance.

First acceptance locks the driver and request in a transaction, validates fresh
eligibility, creates a trip and booking, records a unique dispatch assignment,
marks the request booked and driver offline. Another driver gets a conflict;
there is no duplicate assignment. These shared rides initially reserve one
request/group per driver trip; pooling multiple bookings is separate future work.
The assigned driver can start, complete or cancel the trip. Riders can cancel an
open search, recover an existing request after restart, see acceptance/driver
contact/number plate, and follow trip status. This does not yet include live
city-to-city driver map tracking, delivery OTP or proof-of-delivery collection.

Authenticated routes:

- `POST /city-to-city/quote`
- `POST /city-to-city/requests` (idempotency key, route/service/passengers or parcel details)
- `GET /city-to-city/requests/active`
- `GET /city-to-city/requests/:id`
- `POST /city-to-city/requests/:id/cancel`
- `POST /city-to-city/driver/presence` (`online`, GPS latitude/longitude)
- `GET /city-to-city/driver/requests`
- `POST /city-to-city/driver/requests/:id/accept`
- `GET /city-to-city/driver/active-trip`
- `POST /city-to-city/driver/trips/:id/start|complete|cancel`

### Google Map and realtime updates

Approved drivers now use a full-screen Google Map with floating drawer/recenter
controls and a bottom request panel. GPS centers the map; incoming/accepted route
markers and road polylines use the existing map components. Pending profiles keep
their application view. The original city-driver map, socket listeners, wallet
logic and kilometre filters are unchanged.

City-to-city uses an independent authenticated Socket.IO connection and namespace:
`c2c:subscribe`, `c2c:unsubscribe`, `c2c:changed`. The server resolves the verified
personal identity and authorizes a city room only using approved, online, fresh
current-city presence. Client city/user IDs do not select rooms. Each connection
also gets its own canonical city-to-city user room. Broadcasts carry only a request
ID as an invalidation signal; request/phone/address details stay behind the
existing authenticated eligibility endpoints.

Create/accept/cancel/progress publish updates after their transaction commits.
Driver cards and customer status refetch immediately on the event. Reconnect and
presence refresh re-authorize subscriptions; polling remains a recovery fallback.
This is foreground realtime delivery, not a new background push notification
system. Socket tests use mocked identities, and UI tests verify that an event
refreshes a request card without advancing the polling clock.

## Personal identity and enrollment in the other driver role

Every app account has one canonical `users.User_ID_Pk`. The same person may have
both `drivers.User_ID_FK` and `city_to_city_drivers.user_id` referencing that ID.
Adding either driver role does not insert another personal account or overwrite
`users.Role`. Employees continue to use their independent employee identity.

For a new normal-driver signup, the personal user and pending driver application
are inserted in one transaction. Public signup rejects an already registered
phone and asks the person to sign in. Authenticated enrollment derives the user ID
from the verified session; submitted ownership fields cannot select another user.
Phone registration is serialized across app OTP signup, public driver signup and
franchise member creation. Driver OTP login also preserves/repairs its own canonical
user link instead of making another personal record based on a different role.

City-to-city drivers applying to become normal drivers use:

- `GET /user/driver-enrollment`: personal/vehicle prefills and reusable document
  availability for the authenticated owner, with no private file keys/passwords.
- `POST /user/driver-enrollment`: normal driver fields and missing uploads only.

The existing driver signup screen reuses the owner's photo, CNIC front/back and
licence when available and not rejected/expired. Changing the CNIC requires new
CNIC images. Vehicle registration is reused only for the same plate and model;
choosing a bike/rickshaw or another vehicle requires that vehicle's own document.
The normal vehicle category is selected from its existing fare-category dropdown.
The city-to-city car, documents, approval and wallet are left unchanged. A normal
driver application is independently pending and needs its own admin approval.
Retries return the linked application instead of inserting a duplicate driver.

No schema change is required for this reverse-enrollment feature; it uses the
existing user links and private document store. Existing duplicate personal
accounts are not merged or deleted automatically.

## Unified phone login and saved app mode

The current mobile app has one phone/OTP login for riders and both driver roles.
There are no password fields on login or personal signup. Driver signup selection
also verifies/creates the personal account before opening its document form.

Apply `db/migrations/add_mobile_last_active_mode.sql` (or run
`node scripts/configureMobileAuth.js --apply`) before deploying this version.
`users.last_active_mode` stores `rider`, `driver`, or `city_to_city_driver`; it is
separate from identity, `users.Role`, and driver approval. NULL on legacy accounts
uses linked profiles and the existing role as the first-login fallback.

Current endpoints under `/auth`:

- `POST /mobile-login` accepts `{phone}` and sends a login OTP.
- `POST /mobile-register` accepts `{full_name,email,phone,signup_mode}` and sends a
  signup OTP. It creates the personal account only after successful verification,
  with a NULL password and the selected signup mode.
- `POST /mobile-verify-otp` accepts `{phone_number,otp,otp_purpose}`. Purpose is
  returned by the send endpoint. It returns the canonical user, appropriate driver
  profile, saved mode, token and onboarding/status flags.
- `POST /mobile-mode` requires the authenticated personal session and `{mode}`.
  It checks existing trip/approval constraints, persists the selected mode, and
  returns a refreshed session. Missing City-to-City enrollment prompts onboarding
  without changing mode. The legacy City-to-City switch endpoint also persists
  mode for compatible clients.

Codes use SHA-256 storage, a ten-minute expiry, five-attempt limit and one-minute
resend cooldown. Successful verification consumes the code transactionally;
phone registration uses the shared lock to prevent duplicate personal users.
No production OTP or reviewer bypass is returned to the app. Admin/employee login
continues to use the independent admin authentication flow. Legacy API routes are
retained for older mobile clients; the updated app uses the unified endpoints.

Existing normal driver profiles open the original driver dashboard, which retains
its existing approval, wallet and searching checks. Incomplete driver signup resumes
its form. Driver status is normalized for legacy `Active`/`Pending` values. City-to-City applicants similarly
resume onboarding or see independent approval status. Mode selection grants no
approval and moves no wallet funds. Existing passwords and role columns are not
removed or overwritten by this rollout.
