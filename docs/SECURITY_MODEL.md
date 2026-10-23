# Security model — review build

Implemented boundaries: authenticated service sessions (HttpOnly/SameSite; Secure for HTTPS configuration, loopback review uses non-Secure); closed JSON schemas/size limits; CSRF and same-origin custom resume header with no cross-origin permission; scrypt service passwords; administrative TOTP with replay-step checks; encrypted MFA secrets; local bootstrap and one-time offline recovery. Credentials never appear in URLs, default accounts or ordinary logs.

Customer account, shop users, administrator owner and support roles are distinct. Administrative mutations need owner MFA/session/CSRF, reason and audit; manual issue/renew/payment actions record payment references. Audit is append-only via application/ordinary SQL triggers; root/database-owner tampering is outside that boundary. Support can read metadata but cannot obtain customer backup content.

Activation and backup proofs use one-time short-lived session/account/purpose-bound nonces. Backup proof includes payload digest. Writer generation is rechecked inside the same SQLite transaction as backup cursor updates. Backup download requires a proved currently approved installation and independent backup/grace entitlement; changing a tenant/version ID cannot grant content. Pending/rejected/suspended/revoked installations receive no new permit or cloud content.

Private files are outside public/source assets and served only through authorized APIs. Snapshot contract excludes service credentials/permits/keys. Customer local password hashes are part of authorized shop recovery. Encryption in transit/private disk is not E2EE. Server recovery archives use AES-256-GCM with an archive key held separately from the encrypted configuration/database/content.

Known limits: browser code/storage/clock can be modified or erased; nonextractable Web Crypto is not hardware identity. Offline blocks/password resets cannot invalidate an offline signed permit instantly. Clock offset/high-water checks are defensive. Multiple-tab coordination and client gates supplement server authorization, not replace it. User-cleared browser data can remove both shop and keys.

Review endpoints are all gated, including health/assets/admin. No production/staging publication has occurred. Keep repository private if approved separately. Remaining release gates and measured limits are in RELEASE_ACCEPTANCE.md and HANDOFF.md.
