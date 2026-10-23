# contaonline handoff — 2026-10-23

## Scope and immutable source

Only contaonline was changed. Source: feat/approved-seller-app @ 1efb01fc1cd7bc62670510e57c6158734ad4bf05. Its 52 imported files remain byte-identical and Git-blob verified; adaptations are explicit in scripts/adapt-web.mjs and web/. Resource origins, licenses and hashes are in resources/. No Android/native activation/source workflow changes, secrets, customer data, merge, visibility change or deployment are included.

## Reviewable remote batches

| Branch | Remote commit | Successful CI |
|---|---|---|
| feat/phase-1-foundation | 7a1cc78f0d43cf5aefa03c923f2b201d9105e143 | https://github.com/lami216/contaonline/actions/runs/39873932011 |
| feat/phase-2-pwa | ff8c074dd67ba4e04e8f8e52bc5e775baa7d58a6 | https://github.com/lami216/contaonline/actions/runs/39955617447 |
| feat/phase-3-service | faaaee36882a079e34ec1512866499075c1ae131 | https://github.com/lami216/contaonline/actions/runs/39958265798 |
| feat/phase-4-hardening | 72ca3dc5268ec257dd855b5ae8c95510436d97bb | https://github.com/lami216/contaonline/actions/runs/39958715881 |
| feat/phase-5-backups | 25a4e3031224af4e592df317a20af2f6b0c9fdf2 | https://github.com/lami216/contaonline/actions/runs/39960935096 |

Current cumulative review branch: feat/phase-6-review. Code revision e49400035c42085ded622372b1f7dcccd0995801 passed full CI: https://github.com/lami216/contaonline/actions/runs/39975198178 . Both Chromium and WebKit passed 12 PWA cases plus the complete service/accounting/backup/restore flow; dependency audit found zero vulnerabilities. Subsequent documentation/fixture commits rerun the same gates: inspect the latest branch check, not an older badge. See TEST_REPORT.md and FOLLOWUP_REVIEW.md for actual failures and corrections.

## Implemented

Local-first Arabic/French PWA, scoped IndexedDB, local file/text-font PDF export, complete hashed precache, coordinated multi-tab update, local read/export after permit expiry and defensive clock checks. The source accounting remains unchanged. Offline readiness requires both complete resources and an opened durable shop database; failure preserves prior data.

Node 24.22.1/Fastify 5/SQLite WAL service: separate service/local users, administrative MFA and one-use recovery, CSRF/session controls, signed Web Crypto activation, atomic first start and correct renewal dates, manual payments and append-only audit. Customer metadata search/pagination and audited customer/plan editing are tested against 520 synthetic accounts.

Installation approval, activity and writer generation are separate. New keys after absent activity can be automatic, recent conflicts await review, old approved keys remain observable without reclaiming upload authority, and repeated proven overlap creates review rather than permanent automatic rejection. Already enrolled activity/upload proofs survive short service-session expiry without minting permits or extending terms. Content authority is rechecked inside transactions.

Optional separately entitled backups: explicit consent, atomic local snapshot/delta outbox, idempotent durable ACK, private checksummed versions/quota, writer isolation, preview/confirmation/safety restore with original local authentication, independent expiry, 30-day authorized download grace, notice and audited retention CLI. Encrypted server archive/recovery has synthetic roundtrip/tamper/overwrite tests. No off-server destination or scheduler was installed.

## Verification and operating boundary

Latest local full check: 24 tests, 0 failures/skips, six upstream baseline scripts, 52 source fingerprints, lint, types and build. Two independent SQLite-connection tests cover first activation and simultaneous upload/writer transfer. PDF samples were regenerated and all six Arabic/French pages visually inspected with Poppler. Measurements are explicitly synthetic in docs/evidence/MEASUREMENTS.json, not a capacity promise.

Read RELEASE_ACCEPTANCE.md before claiming completion. Physical iPhone/home-screen/offline/share/printing acceptance (IPHONE_ACCEPTANCE.md), broader end-user accounting UI acceptance and real disk/process/network stress remain open. A browser pass cannot replace these gates. Review readiness remains 503, the server binds loopback with a private gate on every route and refuses NODE_ENV=production. No staging endpoint was published. Recommend making the repository private; do not change visibility without separate approval.

## Continuing safely

Use OPERATIONS.md for pinned install, private bootstrap/MFA, migrations, review startup, retention and encrypted archive recovery. Keep issuing/private/MFA/archive keys and databases out of Git/public. Do not copy a live SQLite main file while ignoring WAL or clear local data on migration/quota failure.

Git CLI network access failed in this environment; remote commits were created through the GitHub API while preserving the current remote tree and parent. Local commit IDs therefore differ. Continue from the actual remote head, never force-push local history. Remaining deployment work requires a separately approved target, TLS/proxy/service-user configuration, rollback and acceptance evidence; do not touch VPS/DNS/Nginx now.
