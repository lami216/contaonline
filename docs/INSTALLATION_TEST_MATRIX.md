# Installation policy verification

The policy machine was delivered before implementation in INSTALLATION_POLICY.md. The service separates enrollment approval, a single presence row per installation and writer generation. New keys do not constitute violations. Superseded keys remain observable without automatic writer reclamation or fresh permits. Only repeated proven overlap after the configured grace period creates a review incident; it suspends upload authority, never deletes local data or automatically bans permanently.

Current local result: 24 tests passed, 0 failed/skipped, plus all six upstream baseline scripts, source fingerprints, lint, strict tooling/backend checkJs and build. The original policy batch had 15 tests; later batches add backup, administration, recovery and known-key-channel checks.

Covered: signed permit binding and tamper/expiry; first start and reinstall invariance; automatic replacement after stale presence; live conflict pending without permit; multiple tabs/key heartbeats; sustained overlap and administrative resolution; superseded return without activity or writer takeover; wrong account/key/purpose, nonce expiry/replay, future start; activation rate limit and unchanged expiry; audited suspend/resume/revoke with rollback for missing reason; concurrent first activations on two independent SQLite connections; MFA replay, CSRF and authentication.

Subsequent verified coverage: separate-connection backup-upload/writer-transfer race, current-writer and account-status checks under the content transaction, snapshot/delta/cursor/idempotent retry, tenant/support content denial and recovery without a new subscription start. Known superseded keys remain observable after short service-session expiry, including disabled-account status, without a new permit or content grant. Pending conflicts stay pending for review after their lease expires. See FOLLOWUP_REVIEW.md and TEST_REPORT.md for exact remote results.

Remaining physical acceptance: real phone sleep/resume/network switching and actual iPhone. Client transaction timestamps and upload arrivals are never used by presence detection. A passing synthetic race does not prove all operating failure modes.

The first-service-batch CI succeeded: https://github.com/lami216/contaonline/actions/runs/39958265798 . No deployment or upstream changes.
