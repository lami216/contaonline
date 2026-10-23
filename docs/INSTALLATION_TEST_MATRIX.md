# Installation policy verification

The policy machine was delivered before implementation in INSTALLATION_POLICY.md. The service separates enrollment approval, a single presence row per installation and writer generation. New keys do not constitute violations. Superseded keys remain observable without automatic writer reclamation or fresh permits. Only repeated proven overlap after the configured grace period creates a review incident; it suspends upload authority, never deletes local data or automatically bans permanently.

Actual local result: 15 tests passed, 0 failed/skipped, plus all six upstream baseline scripts, source fingerprints, lint, strict tooling/backend checkJs and build.

Covered: signed permit binding and tamper/expiry; first start and reinstall invariance; automatic replacement after stale presence; live conflict pending without permit; multiple tabs/key heartbeats; sustained overlap and administrative resolution; superseded return without activity or writer takeover; wrong account/key/purpose, nonce expiry/replay, future start; activation rate limit and unchanged expiry; audited suspend/resume/revoke with rollback for missing reason; concurrent first activations on two independent SQLite connections; MFA replay, CSRF and authentication.

Not yet acceptance-covered: race between simultaneous uploads and administrative writer changes, cloud outbox/cursor behavior, real phone sleep/resume/network switching, complete support-versus-backup content authorization, physical iPhone. These remain required before production readiness. Client transaction timestamps and upload arrivals are never used by presence detection. Cloud endpoints do not exist in this batch.

The first-service-batch CI is https://github.com/lami216/contaonline/actions/runs/39958265798 (check actual completion). No deployment or upstream changes.
