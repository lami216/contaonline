# contaonline handoff — 2026-10-23

Source: feat/approved-seller-app @ 1efb01fc1cd7bc62670510e57c6158734ad4bf05. Upstream and Android remain read-only. No deployment, VPS/DNS/Nginx changes, merge or visibility change is authorized.

Verified remote deliveries:
- Phase 1: feat/phase-1-foundation, 7a1cc78f0d43cf5aefa03c923f2b201d9105e143; 52 pinned source files, licensed assets, lockfile and baseline. CI success: https://github.com/lami216/contaonline/actions/runs/39873932011
- PWA batch: feat/phase-2-pwa, ff8c074dd67ba4e04e8f8e52bc5e775baa7d58a6; scoped stores, local export, text/font PDF, gated review server, hashed precache. CI success including 8 Chromium checks and zero detected dependency vulnerabilities: https://github.com/lami216/contaonline/actions/runs/39955617447

Current local branch: feat/phase-3-service. Service accounts, SQLite WAL, sessions/CSRF, administrative MFA/bootstrap/recovery, manual payment and subscription administration, Web Crypto activation and installation policy core are implemented. See SERVICE_REVIEW.md. Eleven local tests plus all six upstream baseline scripts, lint, typecheck and build passed. A real race through two independent SQLite connections produced one period, one writer and one pending request. Real service browser coverage is added to CI; do not assume its result before checking.

The execution environment briefly disconnected then returned with files intact. Remote PWA SHA differs from its local commit because GitHub API was used after git network failed. Never force push. Read the current remote head and use its tree/parent for subsequent delivery; preserve prior remote checkpoint documents.

Next: verify service CI, then implement optional cloud backup with separate entitlement and explicit consent, atomic local outbox, base/deltas, independent writer generation, durable ACK, tenant isolation, restore preview and clean-install recovery, 30-day retention/download/notice and audited deletion. Local-only mode must never upload accounting content.

Remaining acceptance: full PWA update races, real storage exhaustion, Arabic PDF visual QA, WebKit and physical iPhone, operating recovery/load measurement and production hardening. Review metadata currently has bounded initial lists; pagination needs work before expanded use. README, architecture/security/test/operations docs need reconciliation as phases finish.

This is not a complete production application. Readiness remains 503; start rejects NODE_ENV=production. Recommend a private repository without changing visibility. No real customer records, production databases or private issuing keys belong in Git.
