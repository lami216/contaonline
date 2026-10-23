# Operations — review only

No VPS, DNS, Nginx, public staging or production changes have been executed. CI builds/checks; it has read-only repository permissions and no deployment job. The current entry command refuses NODE_ENV=production and readiness remains 503.

Runtime: Node 24.22.1 / npm 11.19.1, Fastify 5.12.7 with lockfile. The official schedules were rechecked on 2026-10-23: https://nodejs.org/en/about/previous-releases and https://fastify.dev/docs/latest/Reference/LTS/ . Node 24 is LTS; retain supported patches and rerun the lockfile/browser/security gates for updates. No Redis, paid SaaS or multi-service infrastructure is required.

## Private local review

Run the README install/check and bootstrap commands. The gate secret, service config, database, backup files, bootstrap/recovery receipts and archive keys must be private. In the repository, only private/ or data/ may hold runtime files; both are ignored. Prefer separate OS-owned directories outside releases for server review. Use owner-only POSIX permissions or equivalent Windows ACLs. Never commit receipts or copy private data into web/, dist/, docs/ or approved-runtime/.

Set STAGING_ACCESS_KEY_FILE and SERVICE_CONFIG_FILE explicitly. npm start binds 127.0.0.1:4318. Every HTTP route needs the review gate. Customer/admin service login adds its own authorization boundary. The review cookie is deliberately non-Secure on loopback HTTP; an approved TLS production entry must set Secure and preserve the same-origin CSRF boundary. Do not expose the review process through an unapproved proxy or serve dist directly.

Admin workflow: create customer/shop, configure plan duration/price/currency/offline policy, record manual payment, issue/renew license with reason/reference, review pending installations and activity incidents. APK URL must be verified HTTPS with a version before enabling download. Support metadata privilege does not grant backup content. No payment gateway is simulated.

## Retention job

With private service config set:

```sh
npm run retention:dry-run
npm run retention:apply
```

Dry run has no mutation. Apply queues in-account expiry notices; eligible deletion requires the full 30-day grace and at least a day after a queued notice. Each deletion rechecks expiry under the SQLite writer lock and audits it. Schedule once daily only after approval of the deployment target; no scheduler was installed here. State changes never run deletion. Local data is untouched.

## Encrypted server backup and disaster recovery

Quiesce service writes/retention during a consistent server archive, or retry if a private file changes/disappears. The utility uses SQLite's online backup API and includes database/audit/config plus retained private files; it never prints contents or key material. Its archive is AES-256-GCM encrypted. Keep SERVER_BACKUP_KEY_FILE separately, with an offline copy; losing it loses archive recovery.

```sh
export SERVER_BACKUP_KEY_FILE=/approved-private/archive.key
npm run server:recovery -- key
npm run server:recovery -- snapshot /approved-private/server.conta.enc
npm run server:recovery -- restore /approved-private/server.conta.enc /approved-private/new-restored-service
```

The key command creates a new 32-byte key and refuses overwrite. Snapshot refuses an existing output; only treat it complete after successful return and a restore drill. Restore authenticates the archive, validates checksums/database/FKs, rebases private file paths and installs into a new directory. It refuses an existing target. Do not point the running service at an incomplete or unvalidated recovery directory. Initial review bounds: 64 MiB per archive entry, 1 GiB aggregate; measure and redesign streaming/storage limits before increasing. Off-server copying is an operator action on the encrypted archive only; no external destination/service has been configured.

Keep app-signing key rings and archive/MFA keys out of Git/public. For planned issuing-key rotation, retain old public verification keys until all accepted permits expire; issue new permits with a new kid/private key through a reviewed private-config change. Do not remove old public keys or reset subscriptions during rotation. A signed old offline permit remains valid until its expiry or a received restriction; key rotation is not an instant offline ban.

## Release / rollback

Use one local disk and a non-root service user behind an explicitly approved TLS proxy. Choose a fixed origin and nonconflicting port with the owner; do not guess VPS paths. Preserve private data separately from release directories. Snapshot and rehearse recovery before migrations. Current server schemas 1/2 are additive; local IndexedDB v2 preserves v1 stores and adds outbox. A rollback must remain schema-compatible; never clear new user data or copy only a live SQLite main file while ignoring WAL. Future unsupported server schema fails closed.

Measurements in evidence/MEASUREMENTS.json are synthetic local health-inject/payload checks, not internet throughput, concurrent user capacity or iPhone performance. Request IDs are returned with failures; no financial payload/credentials are logged. Further telemetry/pagination and acceptance gates are listed in RELEASE_ACCEPTANCE.md.
