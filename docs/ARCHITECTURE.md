# البنية
## التنفيذ المرحلي
واجهة approved-runtime منسوخة بالبايتات المثبتة في resources/source-manifest.json. تبقى مرجعًا غير معدل؛ adaptations الويب في web أو تحويلات build صريحة ومختبرة.
المرحلة الأولى جهزت build حتميًا وموارد محلية واختبارات؛ لا backend حسابات أو خدمة نسخ أو تصريح ويب منفذ بعد.

## الهدف المعتمد
- Modular monolith: Node 24 LTS/Fastify 5، عملية خدمة واحدة وSQLite WAL على قرص محلي مع foreign keys وmigrations وقيود وفهارس ومعاملات.
- IndexedDB محلي لكل نطاق محل: معاملات العمل مستقلة عن network/session. لا خلط حسابي خدمة في قاعدة محل واحدة.
- هوية تثبيت Web Crypto: private key غير قابل للاستخراج حيث يدعم، public key وتحديات nonce قصيرة مستهلكة مرة واحدة؛ ليست hardware attestation.
- تصريح موقّع مستقل: account/shop/license/installation/key fingerprint/version/kid/issued/expiry/entitlements، دون أسرار إصدار.
- session الخدمة HttpOnly/Secure/SameSite وCSRF؛ فتح المحل محليًا لا يعتمد على session سيرفر قصير لكامل مدة الأوفلاين.
- ترخيص التطبيق، نشاط التثبيت، وسلطة النسخ ثلاث محاور مستقلة. app/backup expiry مستقلان كذلك.
- النسخ: snapshot أساس + deltas ثابتة المعرف والترتيب من outbox ذري، تأكيد cursor بعد الحفظ، إعادة بناء وتحقق وإصدارات. لا تحويل كامل المحاسبة إلى event sourcing.
- الملفات خارج public بمسارات خاصة؛ التنزيل من API مفوض لكل محل، لا URLs قابلة للتخمين.

## سلامة الأوفلاين
نسخة موارد متسقة لكل إصدار، تحقق precache والتخزين والتصريح قبل إعلان الجاهزية، تحديث يحترم المسودات/الكتابة/migrations.
تعطل أو انتهاء الخدمة لا يحذف IndexedDB. تغيير origin أو حذف المستخدم لتخزينه يحتاج خطة استعادة، وليس ضمان نجاة.
SQLite WAL كاتب واحد في اللحظة، لا filesystem شبكي؛ التوسع الأفقي ليس ضمن التصميم الحالي ولا وعد سعة دون قياس.
