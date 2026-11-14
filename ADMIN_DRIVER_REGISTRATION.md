# Direct admin driver registration

Deploy backend and admin panel together. Before using Add Driver, apply `db/migrations/add_admin_driver_registration.sql` to the backend database using the deployment's normal migration process. This creates only the request ledger; it does not edit existing accounts. No live migration is performed by this change.

The Drivers and City-to-City Drivers pages each have an Add Driver form. Their endpoints are:

- `GET /admin/drivers/registration-options`, `POST /admin/drivers`
- `GET /admin/city-to-city-drivers/registration-options`, `POST /admin/city-to-city-drivers`

Existing signed employee sessions and the corresponding `drivers` or `city_to_city_drivers` permission are required. Permission is checked again inside the creation transaction. These creation endpoints are separate from the existing `ADMIN_DRIVER_PROFILE_WRITES_ENABLED` flag, which still governs normal driver profile editing/document replacement.

JSON requests contain `{idempotency_key, profile, application?}`. Multipart requests contain the same JSON in `payload`, plus optional `Photo`, `CNIC_Front`, `CNIC_Back`, `License`, `Vehicle_Running_Page` files (8 MB each). Normal `profile` uses the same whitelisted fields as franchise-driver creation. City-to-city `profile` contains personal fields only, and `application` follows the existing city-to-city application contract. The form previews details before sending.

New users have `Role=rider`. An unambiguous, active personal account with the same normalized Pakistani phone can be reused without changing its role, phone, password or franchise. Staff accounts, deleted accounts, ambiguous identities and franchise-linked accounts are rejected. A second profile of the same driver type is rejected; a normal and city-to-city profile can share one user. Both user creation and driver creation commit together. Direct registration assigns no franchise and leaves drivers pending. Approval still checks the existing document/profile requirements. Franchise registration also creates new personal accounts with the rider role; existing accounts are not migrated.

The phone lock matches the existing mobile onboarding lock. A persistent request key/fingerprint protects confirmed retries and lost responses. The form retains an attempted request in sessionStorage until success; retry the unchanged request to recover its original result. After refreshing, files must be reselected if the first request did not complete. A new request key is generated when editing details.

Existing document storage rules apply: public avatars use `UPLOAD_DIR`/`BASE_UPLOAD_URL`; identity/vehicle documents use `ADMIN_DRIVER_DOCUMENT_DIR`. Failed pre-commit requests clean up newly stored files. Files are retained after uncertain commit acknowledgements. No production database or uploads are touched by the mocked tests.
