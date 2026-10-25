# Privacy and account-deletion request follow-up — 2026-10-24

**Historical scope:** the request-only phase below is superseded by [ACCOUNT_ERASURE.md](ACCOUNT_ERASURE.md). The owner subsequently approved actual deletion of all associated records, including financial records. The new document describes implemented erasure, owner/cashier separation, archive/restore handling and verification; earlier “not implemented” statements below are historical.

## Implemented scope

This change is for contaonline only. The imported 52 source files remain byte-identical. The web build replaces the support renderer and adds account-menu privacy access through explicit, fail-closed adaptations. No Android, payment mechanism, license period, entitlement pricing or deployment was changed.

- Arabic/French privacy policy at `/app/privacy.html`, also available as an in-app dialog. Its HTML, modules, CSS and font are in the app precache. Entry points exist before activation, in the account menu, in support, in the PWA banner, on the landing page and next to optional-backup consent.
- The policy describes local accounting, service account/installation data, optional backup content including local-user password verifiers, camera processing, external support, existing backup retention, and the distinction between deletion requests and actual erasure. It makes no blanket encryption or “no data collected” claim.
- `privacyOperator`, `privacyEmail` and `privacyResponseDays` are editable by the MFA owner through public settings. On 2026-10-24 the owner supplied **payzone** and **pay21694@gmail.com** for privacy contact; these are now the defaults for both policy languages and offline fallback. The existing support number is **+22249823328**. The review target remains **30 days**, disclosed as review timing rather than an automatic-erasure deadline. Existing requests retain their recorded target when settings change. Confirm the operating response target before publication; no contact information was invented.
- Technical-support text replaces calls to renew through WhatsApp/telephone. WhatsApp remains an optional technical-support destination; no messages are sent by this change. The service-account button and expired-permit notices use account/status wording.
- A race guard prevents overlapping PWA status refreshes from duplicating buttons. An open privacy dialog blocks coordinated updates from interrupting its form.

## Account-deletion requests

Migration 3 adds `privacy_deletion_requests` and a unique index allowing one open request per customer. The supported states are `requested`, `in-review`, `needs-verification`, and `withdrawn`. **There is intentionally no “completed” state or button pretending data was erased.**

1. Open **الخصوصية والحساب / Confidentialité et compte**.
2. Sign in with the customer **service** account, not a local cashier password. A separate HttpOnly/SameSite privacy cookie and session-bound CSRF token leave the shop's existing service session intact. Privacy access remains possible when the app license has expired, when no app license exists, and for disabled customer accounts with valid credentials; their normal service access remains blocked.
3. The screen lists all shops belonging to that service account. It clearly requests erasure of the account and associated data across those shops, rather than deactivation or deletion of a single employee.
4. A fresh service password and explicit authority confirmation are required to submit or withdraw a request. The account comes from the session; client-supplied account identifiers cannot choose a different tenant. Requests are idempotent and audited, and reauthentication is rate limited.
5. Acceptance disables all server-side backup consents for that customer. The current shop's local upload configuration is paused without clearing its outbox or saved shop. Concurrent/current upload proofs still encounter the disabled consent at the transaction boundary. Backup re-enablement is refused while a request is open. License dates, local read/write permissions, existing backups and accounting data are not reset or deleted by a request.
6. The customer sees the receipt, status, review target and the operator's message in the app. Withdrawal is allowed before erasure, but does not re-enable backup uploads automatically.
7. The MFA owner has a separate paginated queue in `/admin/`, can mark review/authority verification, and can publish Arabic/French progress messages. Support accounts cannot administer these requests.

The requester never needs to send an email or WhatsApp message just to initiate or follow the request. No new account password, MFA secret, customer document or issuing key is exposed in this UI.

## Required before an erasure workflow can be represented as complete

This iteration implements **initiation, receipt, withdrawal and operator review**, not a full account-erasure engine. Do not tell a customer or Apple that submission itself deletes their account, and do not treat this iteration as release acceptance.

The operator still needs to approve and implement an erasure runbook covering the active service database, optional-backup files and metadata, payment records, append-only audit, old encrypted archives, retention obligations (with an actual basis and period, not a generic claim), and notification of completion. A restore must not silently resurrect erased accounts. Decide how a customer receives completion when the account no longer exists. Remote requests cannot erase disconnected devices or downloaded files; local-device deletion needs its own owner-authorized and clearly confirmed operation.

The append-only audit and financial-record invariants have not been bypassed or silently changed to make deletion appear complete. Existing local shop data has not been erased. Closing a privacy request as complete is deliberately unsupported until those matters are handled. This is an explicit release blocker, not a hidden success state.

## Verification

- `npm run check`: source fingerprints, all six baseline scripts, lint, types, build and **28 tests** passed. Four new privacy tests cover idempotency/isolation, consent pause and re-enablement, unchanged license terms/preserved copies, separate sessions, CSRF/reauthentication/confirmation, disabled-account access, owner-only review, unsupported completion, and built/precache privacy assets/support adaptation.
- Early checks found test typing errors and a wrong expectation that Fastify rejects unknown fields. Fixed the typing and verified the real boundary: Fastify strips extra fields while the authenticated session alone selects the account. The final check passed.
- Local Chromium/iPhone-size browser check: coordinated update, account/support entry points, technical-support copy, privacy login, submission/receipt and withdrawal on the **synthetic local demo account**. No account erasure was executed. Physical iPhone/Safari, Files/printing and App Store binary acceptance are still open.
- Final browser pass after the refresh-race fix: one privacy button in the status bar, policy in Arabic/RTL and French/LTR at 393 × 852, no horizontal overflow, and no captured application/policy console errors. The synthetic request was withdrawn and the live local shop remained usable. The account and policy tabs remain open for review.

## Official references checked on 2026-10-24

- [Apple: complete review information and demo accounts](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/)
- [Apple: initiating account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/)
- [Apple: privacy disclosures](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple: review guidelines](https://developer.apple.com/app-store/review/guidelines/)

Apple case **103006435820** remains the separate payment-model inquiry. This change does not claim an answer or approval from Apple.
