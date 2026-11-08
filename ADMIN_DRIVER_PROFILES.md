# Driver profiles, status, and documents

New profile and document mutations are **disabled by default**. No migrations, account changes, live uploads, approvals, or deletions are performed by developing or testing these features. Keep `ADMIN_DRIVER_PROFILE_WRITES_ENABLED` absent or `false` for a sensitive database. The flag applies to the new profile/document endpoints, not existing wallet top-up or mobile endpoints.

## Inspect and preview

The driver list now includes CNIC, vehicle details, joining date, presence/availability, four core document indicators, completion count, and view/edit/approve-or-block actions alongside the existing wallet button.

`GET /admin/drivers/:id/profile` returns editable profile fields, current status, availability, six document metadata entries, approval requirements, a concurrency version, and `writes_enabled`. It does not return passwords, bank/mobile account values, or raw document paths. The editor permits local drafts even when saving is disabled; **Confirm and save** remains disabled. Local file selections create browser previews and are not automatically uploaded.

Documents: photo, CNIC front, CNIC back, driving license, vehicle registration, and fingerprint document. The first four are required for new approval. Existing documents can be viewed; the list's presence indicators mean a path is recorded, not that the file's physical existence has been verified. A missing/unreachable file produces a preview error rather than a fabricated image.

`GET /admin/drivers/:id/documents/:key` streams the selected image/PDF after admin JWT authentication. Legacy upload URLs are restricted to the configured `BASE_UPLOAD_URL` origin and path; redirects, unrelated hosts, and path traversal are rejected. Local reads remain inside configured public/private roots. Supported preview types are JPEG, PNG, WebP, AVIF, and PDF, with an 8 MB limit.

## Profile changes (implemented, disabled until explicitly enabled)

`PATCH /admin/drivers/:id/profile`

```json
{
  "version": "<current profile SHA-256 version>",
  "changes": {
    "full_name": "Driver name",
    "city": "Karachi",
    "status": "pending",
    "is_available": true
  }
}
```

Allowed fields: full_name, father_name, CNIC, phone, email, address, city, date of birth, vehicle type/model/number/color, joining date, status, and availability. IDs, account roles, passwords, wallet balances, payment-account fields, and online GPS state cannot be edited here. Changes affect the driver profile only; linked user credentials/profile fields are not rewritten automatically.

The server rechecks the admin account, locks the driver row, compares the concurrency version, validates changes, and commits one transaction. Stale drafts return 409 and must be reloaded/reviewed. Duplicate driver phone numbers are rejected. Moving a driver to Active requires the core documents, full name, phone, CNIC, vehicle type, and plate number. Existing files are never deleted by a status change. No destructive delete endpoint is added.

## Document upload (implemented, disabled until explicitly enabled)

`POST /admin/drivers/:id/documents/:key` with multipart fields:

- `document`: one file, maximum 8 MB.
- `version`: current profile version.
- `replace`: string `true` only for an intentional replacement.

The write guard runs before file parsing or database access. Content signatures, rather than filename extensions, determine accepted formats. Photo uploads must be images. New identity documents are stored outside the public upload tree in `ADMIN_DRIVER_DOCUMENT_DIR` (default `private_uploads/driver-documents`) and accessed through the authenticated document endpoint. Driver photos retain the existing public-avatar convention. Existing storage files are preserved on replacement. A new file is cleaned up after a definitive pre-commit rejection; uncertain failures preserve it to avoid breaking a possibly committed reference.

Missing/false `ADMIN_DRIVER_PROFILE_WRITES_ENABLED` returns 423 `DRIVER_WRITES_DISABLED`, without a database write or file upload. Enabling it is a separate deployment decision after the owner approves writes to the sensitive database. This implementation has not enabled it in the live `.env`.

## Validation

Tests use injected in-memory database fixtures, temporary test directories, and fully intercepted browser API requests. They cover default read-only behavior, profile field whitelists, concurrency conflicts, missing-document approval checks, duplicate phones, private storage, content signatures, path/host restrictions, local previews, and mocked saves/uploads. No live database mutations are needed for verification.
