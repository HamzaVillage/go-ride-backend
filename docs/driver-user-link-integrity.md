# Driver personal-account integrity

Every app driver belongs to one canonical personal user. Signup creates a missing
personal account and normal driver atomically, or derives an existing owner from
verified authentication. Role changes never create another personal identity.
Signup/OTP/franchise creation share a normalized-phone registration lock.
Failed creation rolls back both records; retries do not create another driver.

`node scripts/auditDriverUserLinks.js` is read-only and reports absent parents,
shared normal-driver user IDs, phone mismatches, deleted/staff identities and
missing/duplicate City-to-City user links. Candidate IDs are hints, not permission
to transfer profiles, documents or wallet history. Legacy problems are never merged
or reassigned automatically. The dated audit is in `docs/audits`.

`node scripts/configureDriverUserLinks.js --apply` installs an indexed restrictive
foreign key for normal drivers and serialized insert/ownership-update triggers.
New drivers cannot use null/nonexistent parent IDs or share another normal driver
profile's personal user ID. Parent row locking serializes concurrent inserts even
when existing legacy duplicates prevent a global unique index. Old conflicting
ownership is preserved for review; unrelated updates do not silently reassign it.
City-to-City already has a unique user key and foreign key.

Admin activation checks the personal account exists, is active/nonstaff, has the
same normalized phone, and owns exactly one normal-driver profile. Phone edits
must also preserve that relationship. Existing approval/document and ride/wallet
eligibility rules remain in force. These guards reject invalid state instead of
reporting a successful approval that the account cannot use.

Before production scaling, review the flagged historical records, reconcile each
profile with its intended personal owner and money/history attribution, then add
a global unique index after a fresh clean audit. Do not disable foreign key checks
or bulk-reassign users based only on Role or the first phone match.
