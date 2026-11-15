# Franchise administration

Deploy the backend and admin panel together. Before starting the updated backend, install the existing franchise staff/member storage and supporting directory indexes in the intended database:

```sh
cd /var/www/html/apis/go-ride-backend
npm run setup:franchises
npm run setup:franchises -- --apply
pm2 restart goride-backend --update-env
```

The first command is a dry run. The apply command preserves existing records, creates `employee_franchise_access` and `admin_franchise_member_requests` if absent, seeds missing existing operation screen codes without granting any roles, and adds indexes beginning with `Franchiser_ID_FK` to drivers/users only when absent. Existing employee-access tables and legacy `franchiser`, `drivers`, `users`, and `ride_history` tables are required. No production command has been run as part of implementation. `setup:employee-access` also installs this dependency for new installations.

## Administration

1. As super administrator, open Franchises → Add franchise. Name, city, contact person and phone are required; country defaults to Pakistan. Complete the cities of legacy franchise profiles before registering members.
2. Define a reusable role using the existing screen catalog and separate action bits. Relevant screens are 01 Overview, 02 Rides, 03 Drivers, 04 Riders, 05 Franchises, and 16 Franchise Drivers & Riders. Give 16 View + Add to staff who register drivers; give 03 View + Edit if staff should manage their drivers' profiles/documents. No per-franchise functions or duplicated roles are required.
3. In Employee access, add/edit an employee, assign the role and select **Data access / assigned franchise**, then save. The role and franchise assignment are saved in the same transaction. Only super administrators can change scope, and self-assignment changes are blocked. Selecting **Global workspace (all franchises)** explicitly gives global data scope within the employee's role permissions. Existing unassigned central employees retain global role-based access. A missing/inactive franchise referenced by an assignment denies access rather than falling back to global scope.
4. Franchise employees open Franchise Drivers & Riders to register drivers. The server derives/checks their franchise ID, verifies the franchise is active and requires the member city to match the franchise city. A fresh driver gets a linked rider account in one transaction and remains pending until documents are approved. Existing accounts cannot be transferred or duplicated by this form. Duplicate/retried requests retain the existing request-key protections.

## Isolation

For assigned employees, the backend restricts overview totals/charts/cities/recent rides, driver count/list/city options, rides, rider lists, franchise profiles and member creation. Detail, document and wallet IDs are checked against the franchise before handlers run; profile/ledger writes recheck ownership inside their transaction. Request query/body franchise IDs cannot override staff scope. Global employee administration, notification broadcasts, offers, support/report directories, settings and city-to-city administration are unavailable to assigned franchise accounts even if their role includes these screens. Franchise profiles are view-only for assigned staff. Super administrators retain central access.

Every request rechecks the database assignment. The admin panel polls access; a changed assignment clears cached data, and an access-verification error hides the workspace. Scope changes invalidate the employee version so an older employee draft cannot silently overwrite them.

## Reporting definitions

Reports cover normal `ride_history` rides performed by drivers currently linked through `drivers.Franchiser_ID_FK`. Rides include customers outside the franchise when served by one of its drivers; account totals count only accounts assigned to the franchise. Unassigned ride requests are not attributed to a franchise. Historical figures follow the driver's current assignment; this version does not add a driver-transfer workflow or historical franchise snapshot column.

Completed gross fares, recorded platform fees, and driver earnings (gross fares minus recorded platform fees) are displayed separately. These are recorded figures, not confirmed settlements. Franchise commission/royalty payments are not calculated: an agreed commercial formula is required before implementing them. No driver balances or ride settlement formulas are changed.

## Verification

`tests/franchise-isolation.test.js` covers role reuse, fail-closed assignment, cross-franchise IDs, query scopes, dashboard isolation, creation and employee assignment. Browser fixtures exercise required city, creation/refetch, saved employee scope, scoped navigation and small-screen forms. Tests use mocks; a live database migration/deployment must be performed separately.
