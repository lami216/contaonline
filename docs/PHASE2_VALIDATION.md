# Phase 2 review

Implemented: isolated web build adaptations, private review gate on every HTTP route, loopback-only review server, service-account activation gate, installation-bound signed permit verification, independent per-shop IndexedDB, durable-write expiry gate, local JSON/XLSX export path and text/font PDF, complete hashed app precache, explicit coordinated service-worker update, persistent-storage explanation, Arabic/French landing page with APK disabled until configured.

Imported runtime remains byte-identical. No Android activation, private signing material or client records are included. Restoration now checks the revision and preserves the previous users and state inside one IndexedDB transaction. Drafts are namespaced by service account and shop.

Local checks on 2026-10-23: all six upstream baseline scripts, source fingerprints, lint, strict tooling typecheck, build and five unit/integration tests passed. Build has 58 precached resources and 62 files, `deployable=false`. New browser suite uses only synthetic permits and no service test-activation endpoint.

Local browser attempt was blocked by the execution environment: Chromium reported `ERR_NETWORK_ACCESS_DENIED` when connecting to the loopback test server. No E2E success is claimed from that attempt. Dependency audit also could not reach the npm registry (`ENOTFOUND`). Both checks are required in CI. Physical iPhone acceptance remains outstanding. PDF structural tests check fonts/text and absence of raster images; Arabic visual acceptance, Files sharing, actual camera fallback, update races and real storage exhaustion remain acceptance work.

The phase does not include live account administration, production activation, installation/presence adjudication or cloud backup. Their endpoints deliberately do not exist yet. The landing page and backend cannot be deployed to production through this command. No deployment workflow exists.
