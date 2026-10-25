# payzone administration workspace — 2026-10-24

The owner authorized simplifying the existing local administration into a customer directory and one institution page containing subscriptions, installations, backups and alerts. They alone operate payzone for now. The existing manual payment model remains unchanged while Apple case **103006435820** is pending. No publication, extra staff account or change to Android/upstream code is included.

## User flow

- `/admin/` has an Arabic RTL layout for desktop and phone, an MFA login, a customer-only directory, name/owner/login search, pagination and filters for attention, upcoming expiry, installation review, backup-operation failure and disabled accounts. Summary cards count the complete directory, not merely the loaded page.
- `#institution/<account-id>/<tab>` supports direct links and authenticated reload. Every institution has overview/alerts, subscriptions, installations, backup status and account tabs. The owner also has its manual payment records. Shop names and usernames replace identifier selectors in normal workflows; a technical installation ID remains available on demand.
- The overview lists all shops belonging to the service account. Edit actions bind to the selected shop. Renew/status/device/payment/access/code actions bind to the open institution or chosen scoped record. Forms show a separate review step before saving; returned activation/owner secrets appear once in a separate delivery dialog and leave the DOM when closed. Secrets are not stored in browser persistence or placed in URLs.
- Device approval, recent activity and designated backup writer are displayed separately. Writer designation does not imply a valid backup subscription or consent. Backup views contain status, dates, counts and storage metadata; they do not expose content, keys, paths or a download action to administrators.
- The privacy page preserves review and actual-erasure queues as separate workflows. It has no manual completion shortcut. Unfinished erasures are listed before completed receipts; global counts cover all jobs, including those beyond the 100 visible rows. Device incidents likewise prioritize unresolved records.
- Plans and public support/privacy/APK settings have separate pages. Support-role access remains read-only, with financial records and owner actions withheld by the server. This phase does not create support users.

## Server and data boundaries

`server/admin-read.mjs` serves the new metadata model through:

- `POST /api/admin/customers/search`: MFA administrative session + CSRF, bounded cursor/limit and explicit filters; only customer accounts enter results.
- `GET /api/admin/customers/:id`: scoped shops/licenses/installations/incidents/backup metadata and the account's recent history. Payment rows and their audit events plus privacy details/owner-code status are withheld from support.
- `GET /api/admin/catalog`: plan/public-setting metadata for existing forms.

All institution data is selected on the server. The page does not fetch a global accounting/backup dataset and rely on client filtering. No password verifier, MFA secret, installation key/fingerprint, private backup path/checksum or snapshot enters these responses. A backup failure is labelled as an account-level failed operation; the existing log does not reliably identify its shop, so the UI does not invent that attribution.

The existing edit-customer API accepts an optional `shopId`, verifies ownership inside the transaction and updates only that shop when supplied. The new UI always supplies the selected shop. Callers omitting it retain the legacy behavior. No payment, renewal, activation, consent, archive-erasure or first-start rule was changed. Additional SQLite indexes support directory reads; no business-schema migration is needed.

Manual amounts remain in their original `*_minor` unit and are labelled explicitly; no currency/unit conversion was introduced. Recording a payment does not renew a license; renewal remains a separate existing action with reason/reference. Reinstall/restore still does not restart the period.

## Verification

Final `npm run check`: **39 tests passed**, six source baseline scripts, 52 source fingerprints, lint, types and build passed. Final `npm run test:e2e`: Chromium passed the 12 PWA cases, the full service/accounting/backup/restore/erasure flow and all eight administration flow checks. No browser page errors were captured.

Four new integration tests cover full-directory search/filter/pagination beyond 500 accounts, secondary-shop search, tenant-scoped detail/secret exclusion, support/MFA/CSRF boundaries, scoped profile updates and foreign-shop rollback, and unfinished receipts remaining visible behind more than 100 completed jobs.

The new Chromium administration browser flow covers MFA login, filters/branch search, review-before-commit, tenant-scoped renewal, exact manual-payment recording independent of renewal, device writer changes without changing expiry, metadata-only backup view, branch-only edits, privacy review without erasure, one-time credential delivery/cleanup, deep-link session resume, every tab at 393 × 852, desktop layout at 1440 × 1000 and restricted support access. The existing PWA and service/accounting/backup/restore/erasure browser suites remain required.

An initial browser test used an ambiguous institution-heading selector (both page title and shop card); it was narrowed to the page's level-one heading. Visual review also found the mobile brand overlapped logout; alignment was corrected. Screenshot preview data is explicitly synthetic. The running local review retains its original demo institution; no real payment or account was created/renewed/deleted through the visible review.

Physical iPhone/Safari acceptance is still unavailable. Administrative work requires an online service; it is not queued offline. Admin scripts/styles are excluded from the shop's precache. No outside deployment, payment integration, notification messaging or Apple follow-up was performed.
