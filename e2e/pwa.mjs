import { chromium } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createApp, stagingDigest } from '../server/app.mjs';
import { base64url, fingerprint, permitMessage } from '../shared/permit.mjs';

// Entirely synthetic fixtures; there is no test-activation endpoint in the application.
const issuer=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const keys={fixture:await crypto.subtle.exportKey('jwk',issuer.publicKey)};
const username='fixture-review',password=randomBytes(32).toString('base64url');
const app=await createApp({distDirectory:fileURLToPath(new URL('../dist',import.meta.url)),stagingHash:stagingDigest(username,password)});
const base=await app.listen({host:'127.0.0.1',port:0});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
let count=0;
const pass=label=>{count++;console.log('PASS '+label);};
async function seed(page,account='fixture-account',shop='fixture-shop',expired=false){
  const identity=await page.evaluate(async account=>{const store=await import('/app/service-store.js');const i=await store.identityFor(account);return {accountId:i.accountId,id:i.id,publicJwk:i.publicJwk};},account);
  const envelope={schema:'contaonline-permit',version:1,kid:'fixture',payload:{accountId:account,shopId:shop,licenseId:'fixture-license',installationId:identity.id,keyFingerprint:await fingerprint(identity.publicJwk),storeName:'متجر الاختبار',customerName:'مالك الاختبار',issuedAt:Date.now()-100000,expiresAt:Date.now()+(expired?-1000:86400000),entitlements:['app.use']},signature:''};
  envelope.signature=base64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},issuer.privateKey,permitMessage(envelope)));
  await page.evaluate(async({envelope,keys,account})=>{const s=await import('/app/service-store.js');await s.installPermit(envelope,keys,await s.identityFor(account));},{envelope,keys,account});
  await page.reload();
}
try{
  const context=await browser.newContext({httpCredentials:{username,password},viewport:{width:393,height:852}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const uploads=[];page.on('request',r=>{if(r.method()!=='GET')uploads.push(r.url());});
  await page.goto(base+'/app/');await page.locator('#service-login').waitFor();
  assert.equal(await page.locator('[data-action="site:setup"]').count(),0);
  await page.evaluate(()=>location.hash='go:sale');assert.equal(await page.locator('#service-login').count(),1);
  pass('unactivated browser and deep link cannot reach local owner setup');
  await seed(page);await page.locator('#site-auth-form').waitFor();
  await page.locator('[name="username"]').fill('local-owner');await page.locator('[name="password"]').fill('fixture-local-pass');
  await page.locator('[data-action="site:setup"]').click();
  await page.waitForFunction(()=>globalThis.ContaoRuntime&&!document.querySelector('#site-auth-form'));
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  await page.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.includes('جاهز'));
  const state=await page.evaluate(async()=>{const {WebShopDatabase}=await import('/app/web-database.js');const db=await new WebShopDatabase().open();return db.load();});
  assert.ok(state?.opening);pass('complete verified precache plus signed permit and durable IndexedDB setup');
  await context.setOffline(true);await page.reload();
  await page.waitForFunction(()=>globalThis.ContaoRuntime&&!document.querySelector('#service-login'));
  assert.equal(await page.evaluate(()=>globalThis.ContaoService.canWrite()),true);
  assert.equal(uploads.length,0);pass('offline reload preserves shop; local-only mode sends no accounting uploads');
  await page.evaluate(async()=>{const {WebShopDatabase}=await import('/app/web-database.js');const db=await new WebShopDatabase().open();const s=await db.load();s.branding='اختبار حفظ أوفلاين';await db.save(s);});
  await page.reload();await page.waitForFunction(()=>globalThis.ContaoRuntime);
  assert.equal(await page.evaluate(async()=>{const {WebShopDatabase}=await import('/app/web-database.js');return (await (await new WebShopDatabase().open()).load()).branding;}),'اختبار حفظ أوفلاين');
  pass('offline durable write survives closing and reopening document');
  const output=await page.evaluate(async()=>{
    const {reportPdf}=await import('/app/web-report-pdf.js');
    const blob=await reportPdf({brand:'الكرنه',language:'ar',blocks:[{kind:'heading',text:'تقرير المبيعات'},{kind:'table',rows:[['المنتج','المبلغ'],['عطر الاختبار',1250]],widths:[0.7,0.3]}]});
    const text=await blob.text();
    const {recordWorkbook}=await import('/app/record-export.js');
    return {pdf:blob.type,size:blob.size,header:text.slice(0,5),images:text.includes('/Subtype /Image'),workbook:typeof recordWorkbook};
  });
  assert.equal(output.pdf,'application/pdf');assert.equal(output.header,'%PDF-');assert.equal(output.images,false);assert.ok(output.size>1000);assert.equal(output.workbook,'function');
  await page.evaluate(async()=>{const {offerFile}=await import('/app/web-export.js');await offerFile('fixture.json',new Blob([JSON.stringify({test:true})],{type:'application/json'}));});
  const download=page.waitForEvent('download');await page.locator('dialog a[download]').click();assert.equal((await download).suggestedFilename(),'fixture.json');await page.locator('dialog button').last().click();
  pass('offline PDF embeds fonts and text without raster images; JSON download uses local Blob');
  const quota=await page.evaluate(async()=>{
    const {WebShopDatabase}=await import('/app/web-database.js');const db=await new WebShopDatabase().open(),before=await db.load();
    const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readwrite')throw new DOMException('Fixture quota','QuotaExceededError');return original.call(this,stores,mode,...rest);};
    let failed=false;try{await db.save({...before,branding:'must not persist'});}catch{failed=true;}finally{IDBDatabase.prototype.transaction=original;}
    return {failed,unchanged:JSON.stringify(await db.load())===JSON.stringify(before)};
  });assert.ok(quota.failed&&quota.unchanged);pass('failed quota write leaves the previous durable snapshot intact');
  await context.setOffline(false);await seed(page,'fixture-account','fixture-shop',true);await page.waitForFunction(()=>globalThis.ContaoRuntime);
  const expired=await page.evaluate(async()=>{const {WebShopDatabase}=await import('/app/web-database.js');const db=await new WebShopDatabase().open(),s=await db.load();let rejected=false;try{await db.save(s);}catch{rejected=true;}return {canWrite:globalThis.ContaoService.canWrite(),rejected,hasData:!!s};});
  assert.deepEqual(expired,{canWrite:false,rejected:true,hasData:true});pass('expired permit keeps local data and blocks durable accounting writes');
  const scope=await page.evaluate(async()=>{const s=await import('/app/service-store.js');const identities=await Promise.all([s.identityFor('other-account'),s.identityFor('other-account')]);return {same:identities[0].id===identities[1].id,extractable:identities[0].privateKey.extractable};});
  assert.deepEqual(scope,{same:true,extractable:false});assert.deepEqual(errors,[]);pass('concurrent tabs share one nonextractable installation identity without browser errors');
  await context.close();console.log(JSON.stringify({browser:'Chromium',checks:count,physicalIphone:false}));
}finally{await browser.close();await app.close();}
