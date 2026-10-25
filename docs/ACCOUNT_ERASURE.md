# Actual account erasure — 2026-10-24

The owner explicitly approved deletion of **all associated records, including financial records**. This supersedes append-only retention only within the verified, scoped erasure worker. Normal payment/renewal/audit operations remain unchanged. The visible local demo was retained; destructive verification uses disposable automated fixtures.

## Flow and authority

1. Open **الخصوصية والحساب / Confidentialité et compte** and sign in with the service account. Its separate privacy cookie, CSRF and fresh password verification work even for expired, unlicensed or disabled customers.
2. Supply the separate **business-owner management code**. A cashier login or activation password alone cannot erase an institution. New customer creation returns a separate code once. Existing owners need MFA-owner provisioning through `/admin/` after ownership verification. Codes are scrypt-hashed, never logged/audited in plaintext, and must be delivered privately to the business owner rather than staff.
3. Review every shop and counts of licenses/installations/cloud versions/payments/audit plus registered archives. The five-minute receipt is bound to the authenticated account and current credential/code versions. New preview or code rotation invalidates it.
4. Confirm again with the service password, owner code, `DELETE` and the irreversible-erasure checkbox. The server derives the tenant from its session; a client account ID cannot select another customer.
5. Accepted erasure revokes access/uploads and returns a durable private receipt. It remains `pending` until every required operation succeeds, then becomes `complete`. Keep the receipt to check a lost response after the account no longer exists. Retry runs at startup and every 30 seconds.
6. The MFA owner's `/admin/` queue shows phase and bounded error codes. There is no manual “mark complete” shortcut. The earlier request/review queue is a fallback, not proof of erasure. Support-role accounts cannot provision codes or manage privacy/erasure queues.

The owner confirmed they alone operate payzone administration for now. See [PAYZONE_ADMIN_FLOW.md](PAYZONE_ADMIN_FLOW.md).

## Removed data

- All shops, app/backup licenses, installations/presence/incidents, sessions/recovery/challenges, privacy requests/previews and owner-code verifiers belonging to the account.
- All associated payment and audit rows, including structured-metadata relationships. The audit delete trigger is removed/restored only inside the scoped transaction; failure rolls back records and protection. Ordinary audit deletion/update remains forbidden.
- Backup events/streams/consents/versions and every recorded file, including old version paths. New writes use account-hashed folders so owned crash-orphans can be removed. Legacy flat crash-orphans without a database owner block completion rather than being guessed/deleted.
- Account-scoped rate counters. Generic IP-only counters remain transient and contain no account selection. Legacy combined login counters are discarded; new username-hash counters are removable.
- Current SQLite free pages/WAL are scrubbed with secure-delete, checkpoint and compaction. This is not forensic SSD/OS-backup sanitization.
- Every registered encrypted server archive is authenticated, restored into tracked private scratch, filtered against current tombstones, re-encrypted and atomically replaced. Other customers and their subscription dates are preserved.

The service has no local-only accounting content unless optional backup was enabled. Connected old installations receive HTTP 410 and a durable local write barrier; local read/export remain possible. A disconnected signed permit cannot receive instant revocation. Optional device cleanup is a separate explicit action after cloud completion; it deletes only this account's database prefix and permit/identity, preserving other accounts. Previously exported/downloaded files, other devices, unmanaged external copies and physical media remnants cannot be remotely erased.

## Ledger and restore

Migration **4** adds owner verifiers and confirmation previews. The separate private `privacy-ledger.sqlite` defaults beside the service DB, or uses the absolute `privacyLedgerFile` setting. It is excluded from server archives and protected like keys/databases.

After completion it contains HMAC account/installation tombstones, hashed receipts/status/counts and archive locations, with no customer name, username, payment reference/amount or accounting content. Raw account IDs and file manifests exist only while jobs are pending. The minimal technical record prevents old archives from resurrecting erased accounts and is disclosed in both policy languages.

Do not lose the current ledger, roll it back or replace it with an older copy. Protect it separately with a consistent SQLite/WAL-aware operational backup. An old ledger cannot prove that no later erasure occurred. Restore requires the **current matching ledger**:

```sh
export SERVER_BACKUP_KEY_FILE=/approved-private/archive.key
export ERASURE_LEDGER_FILE=/approved-private/privacy-ledger.sqlite
npm run server:recovery -- restore /approved-private/server.conta.enc /approved-private/new-service
```

Format 2 binds the ledger ID. Missing/different ledgers and legacy format-1 archives fail closed; there is no fallback to an empty ledger. Restore filters current tombstones, validates integrity/FKs, checks for concurrent erasure and refuses overwrite. Startup also reconciles an offline restored service that predates a later completed deletion.

Archive publication is registered durably **before** file creation, so a crash leaves a visible missing-file job rather than an unregistered copy. Plaintext scratch/encrypted partials are registered before copying data. Dead-process scratch is removed before erasure completes; active snapshot/recovery keeps the receipt pending.

## Operator failures and limits

Never manually mark completion, remove tombstones to enable a restore, or delete an entire global archive to hide a failure.

- **cloud-files / CHECK_FAILED:** inspect ownership, links and permissions. Reconcile unowned legacy files against a known private inventory; do not infer ownership from names or delete unrelated data.
- **records:** fix storage/FK integrity or implement a reviewed migration for new owned tables. Unexpected dependencies roll back the scoped transaction.
- **archives / ENOENT or CHECK_FAILED:** restore access to the archive and correct key. Tampering/unavailable keys/replacement failure keeps the job pending. An interrupted publication registry entry may be repaired only after verifying its destination is absent and tracked scratch is removed; there is no public bypass endpoint.
- **recovery-cleanup:** wait for active recovery/snapshots; investigate permissions if dead-process cleanup fails. Do not delete arbitrary paths supplied by a customer.

Inventory old unregistered/off-server/format-1 archives before release. Only archives created by the updated utility are automatically managed. The live local service directory contained **zero cloud files and zero `.enc` archives** before this review. No external deployment/destination was configured or claimed to be erased.

## Verification and acceptance

Seven erasure integration tests cover full tenant-scoped financial/audit/file erasure, another tenant preserved, managed redaction and old-copy restore filtering, previously restored-service reconciliation, interrupted scratch, wrong/missing/cross-tenant authority, CSRF, expiry/rotation, late installation activity, code provisioning, failure/restart retry, unsafe paths/unowned orphans, a reader holding old WAL pages, and transactional rollback preserving the audit guard. Final `npm run check`: **35 tests passed**, all six source baselines, 52 source fingerprints, lint, types and build passed.

Chromium at 393 × 852 passed the real flow: wrong code rejected, preview does not delete, final deletion removes cloud versions, a late permit cannot clear the barrier, and device cleanup requires a separate action. The cumulative 12-case PWA flow also passes. Physical iPhone/Safari and App Store binary acceptance remain unverified. The visible local demo was only previewed.

Apple's [account-deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion) was rechecked on 2026-10-24. Reasonable reauthentication/confirmation is permitted; unnecessarily difficult deletion and routine mandatory support flows are not. Deliver owner codes during normal onboarding, provision existing legitimate owners before submission and include the credentials for review. Do not make contacting support a routine prerequisite or claim this implementation establishes App Review/legal acceptance.

Payment inquiry **103006435820** remains separate; payment mechanism, pricing and subscription-start/renewal rules are unchanged.
