# Physical iPhone acceptance — not executed here

WebKit automation is supplementary. No physical iPhone was available in this environment. Record device model, iOS/Safari version, test date, app build/version, tester and pass/fail/evidence for every row. Use synthetic records only. Keep any credentials or issuing keys out of screenshots and reports.

## Prerequisites

Use a separately approved, authenticated TLS staging target. No target was deployed or authorized here. Confirm anonymous root, /app/, /admin/, assets, API and health are denied. Provision a synthetic customer, app license and separate optional backup entitlement using administrative MFA and audited reasons/payment references. Do not copy real customer data or production keys.

## Checklist

| Action | Expected evidence |
|---|---|
| Open landing in Safari; switch Arabic/French and Android/iPhone manually | RTL/LTR correct; iPhone steps visible; APK disabled until a trusted administrative HTTPS/version setting exists; APK data/activation independence stated |
| Open /app/ without activation, including a deep link | Service login required; no local-owner setup or accounting write |
| Authenticate and activate; create local owner | One server subscription start and one approved installation; service account remains distinct from the local user |
| Wait for offline-ready message; add through Safari Share → Add to Home Screen | Resources and shop storage complete before readiness; launch from the icon and record standalone behavior, without assuming installation from an API |
| Seed one product: stock 10, sale price 125, historical cost 75; customer balance 0; cash 0 | Product/customer/warehouse/account visible, with expected starting values |
| Force-close; enable airplane mode; reopen from icon; authenticate locally | Existing shop preserved; no service session needed to open local data |
| Sell one unit cash and one unit credit to that customer | Stock 8, cash 125, customer debt 125, stored total sales profit 100; both invoices retained after another force-close/reopen |
| View stock/debt/history/reports; change current product cost in a separate test copy | Drilldowns match their source documents; earlier stored profit is not recalculated from current cost |
| Export local JSON, Excel and multi-page Arabic/French PDF; use Files/share sheet/printing | Actual files reopen; JSON contains synthetic state, Excel columns/text readable, PDF text/Arabic/Latin/numbers/table headers/footers readable; no financial-content network upload in local-only mode |
| Import a valid local backup with preview and confirmation; try an invalid file | Safety copy and original local-user authentication preserved; invalid input does not replace the shop; no subscription reset |
| Type long product/party names, search larger lists, use numeric keyboard, rotate screen, light/dark themes | Safe areas and keyboard do not hide confirmation/save; touch targets remain usable; names/notes are preserved in both languages |
| Scan barcode, deny camera permission, and try an unsupported decoder case | Clear permission/error message and usable manual barcode input; no promise of BarcodeDetector support |
| Hold an unsaved cart in a second tab; offer a new PWA build | Busy peer prevents activation; cancellation unfreezes; accepted update preserves draft/shop and reloads acknowledged tabs consistently |
| Use an explicitly expired synthetic permit | Local authentication, viewing and export work; new sale/edit/import blocked; no shop deletion and no automatic backup entitlement |
| Optional backup: read consent/30-day notice, opt in, queue offline changes, reconnect in foreground | Last attempt and durable acknowledgement distinct; retry without duplicates; no guaranteed upload while the app is closed |
| Fresh-browser backup restore after approved key replacement | Preview/confirmation/safety copy, original local login, stock/debt/records preserved, subscription start unchanged; old writer cannot merge automatically |
| Put app in background, sleep/wake and switch Wi-Fi/mobile/offline repeatedly | No permanent rejection from a gap or single return; same-key tabs are not treated as two devices; repeated actual overlap can be reviewed |
| End backup entitlement in a synthetic fixture; run audited retention dry-run/apply according to OPERATIONS | No upload, authorized download during grace, account warning before deletion, no early deletion or effect on local data |

If a row cannot run, record blocked/not-run and its reason. Do not mark it passed from Chromium, WebKit, a screenshot or the presence of a button. Real quota/disk/process failure and server operating recovery remain separate checks in RELEASE_ACCEPTANCE.md.
