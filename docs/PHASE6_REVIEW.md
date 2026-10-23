# Phase 6 hardening and verification

Based on backup delivery 25a4e3031224af4e592df317a20af2f6b0c9fdf2, whose CI succeeded: https://github.com/lami216/contaonline/actions/runs/39960935096 . That run proved opt-in, durable offline delta upload and fresh-browser recovery, not just file download.

This batch freezes protected writes/starts of upload during an acknowledged PWA update, cancels/unfreezes if a peer is busy and reloads every acknowledged tab after activation. Browser regression covers a busy second tab, cancellation and coordinated reload preserving the shop, plus defensive clock rollback. Additional service E2E performs real offline cash/credit sales and checks stock/cash/debt/historical profit before backing up/restoring them. Chromium and WebKit are both CI gates; actual results must be checked, not inferred.

Pending-conflict requests remain pending for administrative review even after the original lease expires. Ordinary new-key enrollment after absent activity is still automatic. Missing retained backup bases fail explicitly and do not reset cursors. Migrations are additive/transactional and unsupported future service schema is refused without replacement.

Administrative CLI bootstrap/recovery has a lifecycle test. Credentials/MFA are written privately before committing their activation so a receipt write failure cannot leave a newly activated secret unavailable. Recovery codes are one-use and old service sessions are invalidated.

Implemented a server archive/recovery utility: SQLite backup API, private version files and configuration, AES-256-GCM with a separately held archive key, checksums, integrity/FK validation, rebased private paths and refusal to overwrite an existing target. Synthetic roundtrip/tamper tests passed locally using TEST_TMPDIR in an ignored private test directory. Windows sandbox Temp initially rejected hard-link/directory-rename operations; archive completion now uses exclusive copying and the restored directory is installed only after authentication. No production data was involved.

Poppler visual inspection of synthetic Arabic/French PDF found and fixed fill-color leakage hiding numeric cells and whole-string bidi reversal affecting Latin/numbers. Three-page text/font samples now preserve readable Arabic, Latin names, amounts, repeated headers and footers. No customer data or rendered test artifacts are committed.

Measurements are recorded in evidence/MEASUREMENTS.json. Their scope is explicitly local/synthetic and is not a capacity claim. Deployment and physical iPhone acceptance remain closed; remaining gates are in RELEASE_ACCEPTANCE.md.
