# Recovery — tested boundaries

## Local shop

Accounting is scoped by service account/shop and independent of service sessions. Exported JSON is a separate user-managed file. Deleting website data may remove shop data and installation keys; no browser mechanism guarantees survival. Keep external copies. Closing/reopening or updating app resources does not delete the shop.

Import/cloud restore validates format/state/users, presents preview and requires confirmation. State and users are preserved in a local safety-backup inside the replacement transaction; revision is checked inside that transaction. Local sessions are invalidated and original local users authenticate again. Upload is paused until a reviewed new stream, preventing old restores from silently overwriting a newer server version. The permit/service key/administrative session is not imported and the subscription start does not change.

The real browser suite has recovered into a fresh browser context after an automatic key replacement following absent activity: snapshot plus offline delta, original local owner login, safety copy and unchanged subscription start. Check the exact CI revision for current results. This is stronger than a download-only test but is not a physical iPhone test.

## Service administrator

Bootstrap is explicit and local, with random credentials/MFA in a private receipt and hashed recovery codes. Recovery requires ADMIN_RECOVERY_CODE_FILE and an existing owner username:

```sh
npm run recover-admin -- your-admin-username
```

It consumes a recovery code transactionally, rotates password/MFA/recovery codes, invalidates service sessions and audits the action. Store receipts only long enough to enroll/transfer securely; do not paste secrets in chat. The CLI lifecycle test verifies recovery, replay denial and no credential output. Keep encrypted offline backups of the private configuration and issuing key material. Customer access reset remains an audited owner operation.

## Server disaster

OPERATIONS.md documents the implemented AES-256-GCM archive utility. The test creates an encrypted archive, restores database/audit/private content and configuration into a new directory, checks rebased paths and rejects tampering/overwrite. Archive encryption key is separate from the included service keys. No off-server destination was configured and no production database was used.

Quiesce writes/retention when archiving; a disappearing version file makes the snapshot fail rather than silently omit content. Restored DB integrity and foreign keys must pass. Never restore over a running database or clear IndexedDB on an unknown schema/quota failure. An old application release must understand the newer schema before rollback. No automatic rollback deletes user transactions.

Retention of cloud content is a separate audited job after backup-service expiry, 30 days and prior account notice. It never removes local browser data. A renewed service after prior retention deletion must review and start a fresh backup stream; missing bases produce an explicit error, not a silent cursor reset.
