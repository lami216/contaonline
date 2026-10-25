import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { ServiceStore } from '../server/store.mjs';
import { Licensing } from '../server/licensing.mjs';
import { Backups } from '../server/backups.mjs';
import { PrivacyRequests } from '../server/privacy.mjs';
import { createApp, stagingDigest } from '../server/app.mjs';
import { registerServiceApi } from '../server/api.mjs';
import { passwordHash, otpAt, encrypt } from '../server/security.mjs';
import { privacySettings } from '../shared/privacy.mjs';
async function fixture(){
  const directory=await mkdtemp(path.join(process.env.TEST_TMPDIR||tmpdir(),'contaonline-privacy-')),store=new ServiceStore(path.join(directory,'service.sqlite')),now=1900000000000,password=randomBytes(24).toString('base64url'),hash=await passwordHash(password),encryptionKey=randomBytes(32),totp=randomBytes(20);
  for(const id of ['A','B']){store.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)',id,'fixture-'+id.toLowerCase(),hash,'customer',now);store.run('INSERT INTO shops VALUES(?,?,?,?)','shop-'+id,id,'Synthetic shop '+id,'Synthetic owner');}
  for(const role of ['owner','support'])store.run('INSERT INTO accounts(id,username,password_hash,role,totp_encrypted,created_at) VALUES(?,?,?,?,?,?)',role,'fixture-'+role,hash,role,encrypt(totp.toString('base64url'),encryptionKey),now);
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),licensing=new Licensing(store,{kid:'privacy-fixture',privateJwk:pair.privateKey.export({format:'jwk'}),publicKeys:{'privacy-fixture':pair.publicKey.export({format:'jwk'})}}),backups=new Backups(store,licensing,path.join(directory,'backups')),privacy=new PrivacyRequests(store);
  store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)','backup-plan','Synthetic backup','backup',86400000,0,'MRU',null);
  for(const id of ['A','B']){const license=store.issueLicense('owner',{shopId:'shop-'+id,planId:'backup-plan',reason:'Synthetic fixture approval',paymentReference:'LOCAL-TEST'},now);backups.consent({account_id:id,role:'customer'},{shopId:'shop-'+id,backupLicenseId:license.id,enabled:true,policyVersion:1},now);}
  const authorization='Basic '+Buffer.from('fixture-review:fixture-secret').toString('base64'),app=await createApp({distDirectory:fileURLToPath(new URL('../dist',import.meta.url)),stagingHash:stagingDigest('fixture-review','fixture-secret'),registerApi:app=>registerServiceApi(app,{store,licensing,backups,encryptionKey,secureCookies:false,now:()=>now})});
  /** @param {string} username @param {boolean} privacyOnly */
  async function login(username,privacyOnly=true){const response=await app.inject({method:'POST',url:privacyOnly?'/api/privacy/login':'/api/session/login',headers:{authorization},payload:{username,password,...(username==='fixture-owner'||username==='fixture-support'?{otp:otpAt(totp,Math.floor(now/30000))}:{})}});assert.equal(response.statusCode,200,response.body);return {response,headers:{authorization,cookie:response.cookies.map(c=>c.name+'='+c.value).join(';'),'x-csrf-token':response.json().csrfToken}};}
  return {directory,store,now,password,backups,privacy,app,authorization,login,async close(){await app.close();store.close();await rm(directory,{recursive:true,force:true});}};
}
test('privacy request is idempotent, pauses only its own uploads and preserves licenses, accounting copies and append-only audit',async()=>{
  const f=await fixture();try{
    const before=f.store.all('SELECT * FROM licenses'),file=path.join(f.directory,'backups','synthetic-preserved.json');await writeFile(file,'synthetic local fixture');
    const first=f.privacy.request('A',1,f.now),retry=f.privacy.request('A',1,f.now+1);assert.equal(first.created,true);assert.equal(retry.created,false);assert.equal(first.request.id,retry.request.id);assert.equal(first.request.status,'requested');assert.equal(first.request.responseDueAt,f.now+30*86400000);
    assert.equal(f.store.get('SELECT enabled FROM backup_consents WHERE account_id=?','A').enabled,0);assert.equal(f.store.get('SELECT enabled FROM backup_consents WHERE account_id=?','B').enabled,1);assert.deepEqual(f.store.all('SELECT * FROM licenses'),before);assert.equal(await readFile(file,'utf8'),'synthetic local fixture');assert.equal(f.store.all("SELECT * FROM audit WHERE action='privacy.deletion-request'").length,1);assert.throws(()=>f.store.run('DELETE FROM audit'),/append only/);
    const license=f.store.get('SELECT id FROM licenses WHERE shop_id=?','shop-A');assert.throws(()=>f.backups.consent({account_id:'A',role:'customer'},{shopId:'shop-A',backupLicenseId:license.id,enabled:true,policyVersion:1},f.now),/pending deletion/);
    assert.throws(()=>f.privacy.withdraw('B',first.request.id,1,f.now),/Unavailable/);f.privacy.withdraw('A',first.request.id,1,f.now+2);assert.equal(f.privacy.status('A').request.status,'withdrawn');assert.equal(f.store.get('SELECT enabled FROM backup_consents WHERE account_id=?','A').enabled,0);f.backups.consent({account_id:'A',role:'customer'},{shopId:'shop-A',backupLicenseId:license.id,enabled:true,policyVersion:1},f.now+3);assert.equal(f.store.get('SELECT enabled FROM backup_consents WHERE account_id=?','A').enabled,1);
  }finally{await f.close();}
});
test('privacy API requires its separate session, CSRF, fresh service password and explicit confirmation; disabled or unlicensed customers can still request',async()=>{
  const f=await fixture();try{
    const normal=await f.login('fixture-a',false);assert.equal(normal.response.cookies[0].name,'co_session');assert.equal((await f.app.inject({url:'/api/privacy/deletion',headers:normal.headers})).statusCode,401);
    const privacy=await f.login('fixture-a');assert.equal(privacy.response.cookies[0].name,'co_privacy');assert.equal(privacy.response.cookies[0].path,'/api/privacy');assert.equal(privacy.response.cookies[0].httpOnly,true);
    assert.equal((await f.app.inject({url:'/api/session',headers:normal.headers})).statusCode,200);
    /** @param {any} payload @param {Record<string,string>} headers */
    const send=(payload,headers=privacy.headers)=>f.app.inject({method:'POST',url:'/api/privacy/deletion',headers,payload});
    assert.equal((await send({currentPassword:f.password,confirm:true},{authorization:f.authorization,cookie:privacy.headers.cookie})).statusCode,403);assert.equal((await send({currentPassword:'wrong',confirm:true})).statusCode,401);assert.equal((await send({currentPassword:f.password,confirm:false})).statusCode,400);
    // Fastify strips unknown schema fields; account selection must still come only from the authenticated session.
    assert.equal((await send({currentPassword:f.password,confirm:true,accountId:'B'})).statusCode,200);assert.equal(f.privacy.status('B').request,null);
    const accepted=await send({currentPassword:f.password,confirm:true});assert.equal(accepted.statusCode,200,accepted.body);assert.equal(accepted.json().request.status,'requested');assert.equal(f.privacy.status('B').request,null);
    f.store.run('UPDATE accounts SET disabled=1,credential_version=credential_version+1 WHERE id=?','B');
    const disabledLogin=await f.app.inject({method:'POST',url:'/api/session/login',headers:{authorization:f.authorization},payload:{username:'fixture-b',password:f.password}});assert.equal(disabledLogin.statusCode,401);
    const disabled=await f.login('fixture-b');assert.equal((await send({currentPassword:f.password,confirm:true},disabled.headers)).statusCode,200);
    f.store.run('UPDATE accounts SET credential_version=credential_version+1 WHERE id=?','A');assert.equal((await send({currentPassword:f.password,confirm:true})).statusCode,401);
  }finally{await f.close();}
});
test('only MFA owner can review requests; customer sees its own message; completion and withdrawn-request edits are rejected',async()=>{
  const f=await fixture();try{
    const request=f.privacy.request('A',1,f.now).request,customer=await f.login('fixture-a'),owner=await f.login('fixture-owner',false),support=await f.login('fixture-support',false);
    const body={requestId:request.id,status:'in-review',messageAr:'نراجع طلب صاحب الحساب.',messageFr:'Votre demande est en cours d’examen.',reason:'Synthetic authority review'};
    for(const headers of [customer.headers,support.headers])assert.equal((await f.app.inject({method:'POST',url:'/api/admin/privacy-requests/review',headers,payload:body})).statusCode,headers===customer.headers?401:403);
    const review=await f.app.inject({method:'POST',url:'/api/admin/privacy-requests/review',headers:owner.headers,payload:body});assert.equal(review.statusCode,200,review.body);
    const status=await f.app.inject({url:'/api/privacy/deletion',headers:customer.headers});assert.equal(status.json().request.messageFr,body.messageFr);assert.equal(status.body.includes('password_hash'),false);
    assert.equal((await f.app.inject({method:'POST',url:'/api/admin/privacy-requests/review',headers:owner.headers,payload:{...body,status:'completed'}})).statusCode,400);assert.throws(()=>f.privacy.review('owner',{...body,status:'completed'}),/cannot be marked/);
    const list=await f.app.inject({method:'POST',url:'/api/admin/privacy-requests/search',headers:owner.headers,payload:{cursor:0,limit:50}});assert.equal(list.statusCode,200);assert.equal(list.json().total,1);
    f.privacy.withdraw('A',request.id,1,f.now+1);assert.equal((await f.app.inject({method:'POST',url:'/api/admin/privacy-requests/review',headers:owner.headers,payload:body})).statusCode,409);
  }finally{await f.close();}
});
test('built privacy is available offline and web support has no renewal call to action while upstream bytes stay intact',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url)),manifest=JSON.parse(await readFile(path.join(root,'dist/build-manifest.json'),'utf8'));
  for(const filename of ['privacy.html','privacy.js','privacy-content.js','privacy-page.js','privacy-contract.js'])assert.ok(manifest.files.some(/** @param {{path:string}} file */file=>file.path==='app/'+filename),filename);
  const worker=await readFile(path.join(root,'dist/app/sw.js'),'utf8');assert.ok(worker.includes('/app/privacy.html'));assert.ok(worker.includes('/app/privacy-contract.js'));
  const built=await readFile(path.join(root,'dist/app/app.js'),'utf8'),support=await readFile(path.join(root,'dist/app/privacy.js'),'utf8');assert.ok(built.includes('return webSupportMarkup()'));assert.equal(built.includes('للمساعدة أو تجديد الترخيص'),false);assert.equal(support.includes('تجديد الترخيص'),false);assert.ok((await readFile(path.join(root,'approved-runtime/app.js'),'utf8')).includes('للمساعدة أو تجديد الترخيص'));
  assert.equal(privacySettings({privacyResponseDays:0}).responseDays,30);assert.equal(privacySettings({privacyOperator:'Synthetic operator',privacyResponseDays:14}).responseDays,14);
});
