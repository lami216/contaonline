# Release acceptance — not yet production acceptance

Implemented and exercised in prior successful CI: source hashes/baselines, private gate, signed activation, admin MFA/session/CSRF, concurrent first activation via two SQLite connections, reinstall/expiry/renewal policies, installation/presence/writer separation, optional backup consent, atomic offline delta queue, durable ACK, old-writer denial, tenant/support isolation at content boundaries and clean-browser restoration. Additional phase-6 checks are pending their exact CI result.

The following gates remain explicit; no production deployment is authorized:

1. Physical iPhone/Safari + home-screen installation: activate online, finish offline preparation, force-close, airplane mode, reopen from icon, local login, sale/stock/debt/report/export/import, Files/share-sheet and keyboard/safe-area. Record iPhone/iOS version and results. WebKit automation is supplementary only.
2. Full end-user accounting E2E beyond source baselines: representative sale/purchase/expense/returns/cancellation/debts/history reports with expected values, permissions and large lists. Current browser storage tests and upstream baselines do not prove every UI path.
3. Real storage exhaustion/abrupt process termination, transient file/fsync failure and recovery under disk pressure. Current quota test is injected and archive bounds are explicit.
4. Simultaneous backup upload versus administrative writer-generation changes on separate connections, plus background/sleep/network variations on physical phones. Activation race is already covered; do not substitute it for every upload race.
5. Administration at larger record counts: replace bounded initial 500-row metadata screens with server pagination/search before wider operation; broaden edits/status and support-account provisioning UX. No capacity claim has been made.
6. Review issuing-key rotation tooling, monitoring/redaction, periodic archive restore rehearsal and actual deployment-volume load/space tests. The encrypted archive utility is tested on synthetic data, with entry/aggregate limits documented.
7. Specific staging target, TLS/Secure-cookie configuration, non-root user, domain/origin/port and rollback approval. Current readiness deliberately stays 503 and production startup is refused.

PDF visual review found and corrected fill-color leakage and bidi reversal: text/font PDF, mixed Arabic/Latin/numbers, repeated table headers and page footers were rendered with Poppler on three-page synthetic samples. Recheck after material export changes. Browser Files sharing and actual printing remain device checks.

No missing gate is hidden behind a successful CI badge or a claim that the application is complete.
