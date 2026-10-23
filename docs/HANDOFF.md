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

## Backup batch in progress
Current branch: feat/phase-5-backups, based on remote installation-hardening 72ca3dc5268ec257dd855b5ae8c95510436d97bb. Phase-3 CI succeeded at https://github.com/lami216/contaonline/actions/runs/39958265798 and phase-4 CI at https://github.com/lami216/contaonline/actions/runs/39958715881 .
The optional backup contract, private version store, proof-bound dispatch/download, local atomic outbox, foreground scheduling, consent, safe restore and audited retention are now implemented. See BACKUP_REVIEW.md. Nineteen local tests, all six baseline scripts, lint/typecheck/build passed. Browser backup/clean-install recovery coverage is in CI and must not be reported as passed before its result. Next: fix any browser failures, then complete hardening/operations documents, measured recovery and remaining PWA/WebKit/iPhone acceptance. Do not deploy or claim production completion.

## دفعة تقوية ومراجعة المرحلة السادسة
الفرع feat/phase-6-review مبني على 25a4e3031224af4e592df317a20af2f6b0c9fdf2 ذي CI ناجح. دفعات المصدر والحسابات والتثبيتات والنسخ كلها مرفوعة بسلسلة parents دون merge أو force push.
22 اختبارًا محليًا وbaseline الستة وlint/typecheck/build نجحت. أضيفت اختبارات تحديث PWA متعدد التبويبات وتراجع الساعة وبيع نقدي/آجل حقيقي أوفلاين مع تحقق الحسابات ثم الاستعادة؛ Chromium/WebKit بوابتا CI لهذه الدفعة. لا تكتب نجاحهما قبل قراءة النتيجة النهائية.
أرشفة السيرفر المشفرة والتعافي وCLI bootstrap/recovery اختُبرت ببيانات صناعية. عيوب PDF المكتشفة بصريًا عولجت. راجع PHASE6_REVIEW وOPERATIONS وRECOVERY وRELEASE_ACCEPTANCE وTEST_REPORT. الحالة ما تزال مراجعة دون نشر؛ يلزم قبول جهاز iPhone فعلي وقرارات نشر منفصلة، مع الفجوات المسماة في قائمة القبول.

## Follow-up after first phase-6 CI
The first phase-6 run (39965008741) passed ten Chromium PWA scenarios, then failed because a POS test selector matched two buttons; WebKit was skipped, not passed. The selector is corrected. Server-side customer pagination/search and audited customer/plan edits are implemented and tested against 520 synthetic accounts. A separate two-connection upload/writer-transfer race passed. Known-key status/backup proofs now remain independent of an expired short service session, without minting a permit/session/extension. See FOLLOWUP_REVIEW.md. Local check: 24 tests, all six baselines, lint/types/build pass. Final follow-up CI is still required.
