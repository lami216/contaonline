# contaonline
This repository is the only implementation target. Upstream Contamobile, Android, its activation, keys and workflows are read-only.
The owner approved the decisions in docs/DECISIONS.md; the later installation policy supersedes the initial audit proposal.
Keep approved-runtime byte-identical to resources/source-manifest.json. Make web adaptations explicitly in web/ or build transformations with regression tests.
Do not port Expo, Android, native activation, original workflows, secrets, signing keys, databases or upstream Git history.
Use Node 24 LTS, Fastify 5 and server SQLite WAL on local disk; preserve local-first accounting and Arabic/French.
Keep service accounts separate from local shop users. Backups are opt-in and separately entitled. Never reset subscription dates on reinstall or restore.
New installation keys are not violations. Separate license approval, presence and upload authority. See docs/INSTALLATION_POLICY.md before implementing that module.
No public staging or production deployment, VPS/DNS/Nginx changes, paid SaaS, visibility changes or merging without the relevant owner authorization.
Verify source fingerprints, baseline, meaningful tests, lint, types and build. Record actual failures and unavailable physical-device tests.
Each phase must be a reviewable commit with current docs/HANDOFF.md. Do not claim phase 1 is a complete application.
Do not delegate to additional agents without explicit owner authorization.
