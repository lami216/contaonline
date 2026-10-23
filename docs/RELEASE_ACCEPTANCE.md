# Release acceptance — not yet production acceptance

Implemented and exercised in prior successful CI: source hashes/baselines, private gate, signed activation, admin MFA/session/CSRF, concurrent first activation via two SQLite connections, reinstall/expiry/renewal policies, installation/presence/writer separation, optional backup consent, atomic offline delta queue, durable ACK, old-writer denial, tenant/support isolation at content boundaries and clean-browser restoration. Phase-6 automated gates passed on e49400035c42085ded622372b1f7dcccd0995801 (run 39975198178): both browsers, real cash/credit sales, update coordination, storage/precache failures, session-independent upload and clean-browser recovery. Later commits must pass their own CI.

The following gates remain explicit; no production deployment is authorized:

1. Physical iPhone/Safari + home-screen installation: follow IPHONE_ACCEPTANCE.md, including activation, complete preparation, force-close/airplane-mode/icon launch, local login, known stock/cash/debt/profit values, Files/share-sheet, exports/import, keyboard/safe-area. Record iPhone/iOS version and results. WebKit automation is supplementary only.
2. Full end-user accounting E2E beyond source baselines: representative sale/purchase/expense/returns/cancellation/debts/history reports with expected values, permissions and large lists. Current browser storage tests and upstream baselines do not prove every UI path.
3. Real storage exhaustion/abrupt process termination, transient file/fsync failure and recovery under disk pressure. Current quota test is injected and archive bounds are explicit.
4. Background/sleep/network variations on physical phones. Both activation and simultaneous backup-upload/writer-transfer races now have separate two-connection SQLite tests; neither proves phone lifecycle behavior.
5. Broader administration acceptance and support-account provisioning UX. Customer search/pagination and customer/plan edits are implemented and tested across 520 synthetic accounts. Plans, incidents, payments and audit still have explicit bounded lists; broaden their navigation before wider operation. No capacity claim has been made.
6. Review issuing-key rotation tooling, monitoring/redaction, periodic archive restore rehearsal and actual deployment-volume load/space tests. The encrypted archive utility is tested on synthetic data, with entry/aggregate limits documented.
7. Specific staging target, TLS/Secure-cookie configuration, non-root user, domain/origin/port and rollback approval. Current readiness deliberately stays 503 and production startup is refused.

PDF visual review found and corrected fill-color leakage and bidi reversal: text/font PDF, mixed Arabic/Latin/numbers, repeated table headers and page footers were rendered with Poppler on three-page synthetic samples. Recheck after material export changes. Browser Files sharing and actual printing remain device checks.

No missing gate is hidden behind a successful CI badge or a claim that the application is complete.
