# Architecture — implemented review build

A modular monolith: Node 24 LTS/Fastify 5 with node:sqlite, WAL, foreign keys, FULL synchronous writes and additive transactions/migrations. One service process, one local disk, no Redis/SaaS. SQLite's single writer remains an explicit limit; no user-capacity promise is made.

The imported approved-runtime is immutable, verified against 52 pinned SHA-256/Git blob entries. scripts/adapt-web.mjs makes anchored build-time web adaptations; new browser code lives in web/. Node service code is outside the public build. The server serves only manifest-allowlisted files whose bytes match the build hashes.

Local accounting uses IndexedDB per account/shop. v2 adds outbox without clearing v1 snapshots/users/meta. Service identity and signed permits use a separate database. App-cache replacement never deletes shop databases. Service session cookies expire independently of signed offline permits and local shop authentication.

ECDSA P-256 installation keys are nonextractable where supported. Challenges bind account/session/license/installation/purpose/random nonce and, for backup dispatch, operation/payload digest. Issuing keys and the MFA encryption key stay in a private configuration file. Public verification key rings support overlapping rotation; retained browser permits are self-contained. This is not hardware attestation or absolute anti-copy protection.

Subscription approval/start/renewal, enrollment status, connected presence, and writer generation are separate state. Normal reinstall after absent activity preserves the period. Existing pending activity conflicts await administration. A superseded known key remains observable but cannot reclaim writer authority or issue itself a fresh permit. Multiple tabs share one installation presence row. Upload arrival and client transaction timestamps are not overlap evidence.

Optional backup has an independent license and consent. The local business snapshot/user update and outbox event commit together. A stream starts with a snapshot, then keyed-collection deltas; explicit deletes/edits/order are represented. Server applies and validates a batch under the current writer generation, fsyncs a private version, commits FULL/WAL cursor metadata, then acknowledges. Retries are idempotent. Imports/restores pause sending until a reviewed new stream; older writers cannot merge.

Each received batch materializes a server version, so private disk growth is bounded by quota, not silent active-version deletion. Current guards: 50 events/request, 10 MiB request, 8 MiB materialized snapshot, 256 MiB/account versions. The review archive utility has separate 64 MiB/entry and 1 GiB aggregate limits; measure before increasing.

The review server is loopback-only and all routes require a separate private gate. Production startup and readiness remain closed. Cloud/operations tests do not substitute for the physical iPhone acceptance checklist.
