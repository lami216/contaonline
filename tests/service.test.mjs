import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ServiceStore } from '../server/store.mjs';
import { Licensing } from '../server/licensing.mjs';
import { base64url, verifyPermit } from '../shared/permit.mjs';
import { passwordHash, passwordMatches, otpAt, verifyOtp, encrypt, decrypt, token } from '../server/security.mjs';
import { registerServiceApi } from '../server/api.mjs';
import { createApp, stagingDigest } from '../server/app.mjs';
async function fixture(){
  const directory=await mkdtemp(path.join(tmpdir(),'contaonline-service-')),filename=path.join(directory,'service.sqlite'),store=new ServiceStore(filename),now=1900000000000;
  store.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)','customer-A','fixture-A','test-only-no-login','customer',now);
  store.run('INSERT INTO shops VALUES(?,?,?,?)','shop-A','customer-A','متجر تجريبي','مالك الاختبار');
  store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)','plan-A','fixture plan','app',365*86400000,24000,'MRU',null);
  const license=store.issueLicense('test-admin',{shopId:'shop-A',planId:'plan-A',reason:'Fixture manual approval',paymentReference:'fixture-payment'},now);
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),signer={privateJwk:pair.privateKey.export({format:'jwk'}),kid:'test-fixture-only',publicKeys:{'test-fixture-only':pair.publicKey.export({format:'jwk'})}};
  const licensing=new Licensing(store,signer),session={account_id:'customer-A',token_hash:'test-session-fixture'};
  return {directory,filename,store,now,license,signer,licensing,session,async close(){store.close();assert.ok(directory.startsWith(tmpdir()+path.sep));await rm(directory,{recursive:true,force:true});}};
}
/** @param {Awaited<ReturnType<typeof fixture>>} f */
async function identity(f){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);return {id:randomUUID(),publicJwk:await crypto.subtle.exportKey('jwk',pair.publicKey),privateKey:pair.privateKey,accountId:f.session.account_id};}
/** @param {Awaited<ReturnType<typeof fixture>>} f @param {Awaited<ReturnType<typeof identity>>} i @param {number} now @param {string} purpose */
async function proof(f,i,now,purpose='activate'){
  const c=await f.licensing.challenge(f.session,{licenseId:f.license.id,installationId:i.id,publicJwk:i.publicJwk,purpose},now);
  return {challengeId:c.id,signature:base64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},i.privateKey,new TextEncoder().encode(c.message)))};
}
test('password scrypt and MFA replay window, authenticated encryption and RFC 6238 vector',async()=>{
  const password=token(),hash=await passwordHash(password);assert.ok(await passwordMatches(password,hash));assert.equal(await passwordMatches('incorrect',hash),false);
  const secret=Buffer.from('12345678901234567890');assert.equal(otpAt(secret,1),'287082');assert.equal(verifyOtp(secret,'287082',59000),1);assert.equal(verifyOtp(secret,'287082',59000,1),null);
  const key=randomBytes(32),cipher=encrypt('fixture secret',key);assert.equal(decrypt(cipher,key),'fixture secret');assert.throws(()=>decrypt(cipher,randomBytes(32)));
});
test('first activation starts once; reinstall after absence preserves expiry, history and separated writer generation',async()=>{
  const f=await fixture();try{
    const i=await identity(f),input=await proof(f,i,f.now),first=await f.licensing.enroll(f.session,input,f.now);assert.ok(first.permit);
    assert.equal((await verifyPermit(first.permit,first.keys,i,f.now)).canWrite,true);
    await assert.rejects(f.licensing.enroll(f.session,input,f.now),/already|expired/);
    const j=await identity(f),time=f.now+600001,next=await f.licensing.enroll(f.session,await proof(f,j,time),time);
    assert.equal(next.permit?.payload.expiresAt,first.permit.payload.expiresAt);assert.equal(f.store.get('SELECT starts_at FROM licenses WHERE id=?',f.license.id).starts_at,f.now);
    assert.equal(f.store.all('SELECT * FROM installations').length,2);assert.equal(next.generation,2);
    assert.throws(()=>f.licensing.authorizeUpload(f.session,f.license.id,i.id,1,time));
    assert.ok(f.licensing.authorizeUpload(f.session,f.license.id,j.id,2,time));
    const observed=await f.licensing.heartbeat(f.session,await proof(f,i,time+600001,'presence'),time+600001);
    assert.equal(observed.overlap,false);assert.equal(observed.writer,false);assert.equal(f.store.all('SELECT * FROM incidents').length,0);
  }finally{await f.close();}
});
test('recent conflict is pending without permit; same installation tabs do not create overlap; continued peers do',async()=>{
  const f=await fixture();try{
    const i=await identity(f),j=await identity(f);await f.licensing.enroll(f.session,await proof(f,i,f.now),f.now);
    const pending=await f.licensing.enroll(f.session,await proof(f,j,f.now+1000),f.now+1000);assert.deepEqual(pending,{pending:true});
    for(let k=1;k<4;k++)assert.equal((await f.licensing.heartbeat(f.session,await proof(f,i,f.now+k*60000,'presence'),f.now+k*60000)).overlap,false);
    f.licensing.moderate('test-admin',{installationId:j.id,action:'allow',reason:'Fixture administrative override'},f.now+180000);
    let last;for(let k=4;k<13;k++){const time=f.now+k*60000;await f.licensing.heartbeat(f.session,await proof(f,i,time,'presence'),time);last=await f.licensing.heartbeat(f.session,await proof(f,j,time+1,'presence'),time+1);}
    assert.equal(last?.overlap,true);assert.equal(f.store.all('SELECT * FROM incidents').length,1);
    assert.throws(()=>f.licensing.authorizeUpload(f.session,f.license.id,j.id,2,f.now+12*60000),/review/);
    f.licensing.moderate('test-admin',{installationId:j.id,action:'resume',reason:'Reviewed connected overlap'},f.now+13*60000);
    assert.equal(f.store.all('SELECT * FROM incidents WHERE resolved_at IS NULL').length,0);
    assert.throws(()=>f.store.run('DELETE FROM audit'),/append only/);
  }finally{await f.close();}
});
test('renewal accumulates from live end, expired renewal from administrative approval; audit requires reason and payment reference',async()=>{
  const f=await fixture();try{
    const i=await identity(f);await f.licensing.enroll(f.session,await proof(f,i,f.now),f.now);const old=f.store.get('SELECT * FROM licenses WHERE id=?',f.license.id);
    const live=f.store.renew('admin',{licenseId:old.id,durationMs:86400000,reason:'Fixture renewal',paymentReference:'fixture-renew'},f.now+1);assert.equal(live.ends_at,old.ends_at+86400000);
    const expired=f.store.renew('admin',{licenseId:old.id,durationMs:86400000,reason:'Expired fixture renewal',paymentReference:'fixture-renew-2'},live.ends_at+1000);assert.equal(expired.ends_at,live.ends_at+1000+86400000);assert.equal(expired.starts_at,f.now);
    assert.throws(()=>f.store.renew('admin',{licenseId:old.id,durationMs:1,reason:'',paymentReference:'p'}));assert.throws(()=>f.store.renew('admin',{licenseId:old.id,durationMs:1,reason:'valid reason',paymentReference:''}));
  }finally{await f.close();}
});
test('a recorded recent-activity conflict stays pending for administrative review after the lease later expires',async()=>{
  const f=await fixture();try{const i=await identity(f),j=await identity(f);await f.licensing.enroll(f.session,await proof(f,i,f.now),f.now);assert.deepEqual(await f.licensing.enroll(f.session,await proof(f,j,f.now+1000),f.now+1000),{pending:true});assert.deepEqual(await f.licensing.enroll(f.session,await proof(f,j,f.now+600001),f.now+600001),{pending:true});assert.equal(f.store.get('SELECT writer_id FROM licenses WHERE id=?',f.license.id).writer_id,i.id);}finally{await f.close();}
});
test('known installation observation survives service-session expiry and delivers restrictions without minting a permit or upload grant',async()=>{
  const f=await fixture();try{const i=await identity(f);await f.licensing.enroll(f.session,await proof(f,i,f.now),f.now);const end=f.store.get('SELECT ends_at FROM licenses WHERE id=?',f.license.id).ends_at,time=f.now+9*3600000;
    const challenge=f.licensing.knownChallenge({licenseId:f.license.id,installationId:i.id},'observe',time),input={challengeId:challenge.id,signature:base64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},i.privateKey,new TextEncoder().encode(challenge.message)))};
    const status=await f.licensing.observe(input,time);assert.equal(status.accountStatus,'active');assert.equal('permit'in status,false);assert.equal('payload'in status,false);await assert.rejects(f.licensing.observe(input,time),/unavailable|Unavailable/);
    f.store.run('UPDATE accounts SET disabled=1 WHERE id=?',f.session.account_id);
    const blocked=f.licensing.knownChallenge({licenseId:f.license.id,installationId:i.id},'observe',time+1),blockedStatus=await f.licensing.observe({challengeId:blocked.id,signature:base64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},i.privateKey,new TextEncoder().encode(blocked.message)))},time+1);assert.equal(blockedStatus.accountStatus,'disabled');assert.equal(blockedStatus.writer,false);assert.equal('permit'in blockedStatus,false);assert.throws(()=>f.licensing.knownChallenge({licenseId:f.license.id,installationId:i.id,context:'a'.repeat(64)},'backup',time+1),/current writer/);assert.equal(f.store.get('SELECT ends_at FROM licenses WHERE id=?',f.license.id).ends_at,end);
  }finally{await f.close();}
});
test('known superseded return remains observable without automatically reclaiming writer authority or a fresh permit',async()=>{
  const f=await fixture();try{const old=await identity(f),current=await identity(f);await f.licensing.enroll(f.session,await proof(f,old,f.now),f.now);const later=f.now+600001;await f.licensing.enroll(f.session,await proof(f,current,later),later);
    const returned=await f.licensing.enroll(f.session,await proof(f,old,later+600001),later+600001);assert.deepEqual(returned,{pending:true,superseded:true});
    const observed=await f.licensing.heartbeat(f.session,await proof(f,old,later+600002,'presence'),later+600002);assert.equal(observed.overlap,false);assert.equal(observed.writer,false);assert.equal(f.store.get('SELECT writer_id FROM licenses WHERE id=?',f.license.id).writer_id,current.id);
  }finally{await f.close();}
});
test('activation rejects wrong account, mismatched key, wrong purpose, expired nonce and explicitly future subscription',async()=>{
  const f=await fixture();try{const i=await identity(f),j=await identity(f),input=await proof(f,i,f.now);
    await assert.rejects(f.licensing.enroll({...f.session,account_id:'customer-B'},input,f.now),/unavailable/);
    const bad={...input,signature:base64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},j.privateKey,new TextEncoder().encode(f.store.get('SELECT message FROM challenges WHERE id=?',input.challengeId).message)))};await assert.rejects(f.licensing.enroll(f.session,bad,f.now),/proof/);
    await assert.rejects(f.licensing.enroll(f.session,input,f.now+120001),/expired/);
    await f.licensing.enroll(f.session,input,f.now);
    const presence=await proof(f,i,f.now+1,'presence');await assert.rejects(f.licensing.enroll(f.session,presence,f.now+1),/unavailable/);
    f.store.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)','customer-B','fixture-B','fixture','customer',f.now);
    await assert.rejects(f.licensing.challenge({...f.session,account_id:'customer-B'},{licenseId:f.license.id,installationId:i.id,publicJwk:i.publicJwk},f.now),/Unavailable license/);
    f.store.run('UPDATE licenses SET starts_at=?,ends_at=? WHERE id=?',f.now+1000000,f.now+2000000,f.license.id);await assert.rejects(proof(f,j,f.now),/not active/);
  }finally{await f.close();}
});
test('new installation after absence is automatic, but successful writer switches are rate limited without extending dates',async()=>{
  const f=await fixture();try{let end;
    for(let n=0;n<3;n++){const i=await identity(f),time=f.now+n*600001,result=await f.licensing.enroll(f.session,await proof(f,i,time),time);end??=result.permit?.payload.expiresAt;assert.equal(result.permit?.payload.expiresAt,end);}
    const fourth=await identity(f),time=f.now+3*600001;await assert.rejects(f.licensing.enroll(f.session,await proof(f,fourth,time),time),/Too many/);assert.equal(f.store.get('SELECT generation,ends_at FROM licenses WHERE id=?',f.license.id).generation,3);assert.equal(f.store.get('SELECT ends_at FROM licenses WHERE id=?',f.license.id).ends_at,end);
  }finally{await f.close();}
});
test('administrative suspension/revocation is audited; resuming preserves observation and does not transfer writer',async()=>{
  const f=await fixture();try{const i=await identity(f);await f.licensing.enroll(f.session,await proof(f,i,f.now),f.now);
    assert.throws(()=>f.licensing.moderate('admin',{installationId:i.id,action:'suspend',reason:''}),/reason/);assert.equal(f.store.get('SELECT status FROM installations WHERE id=?',i.id).status,'approved');
    f.licensing.moderate('admin',{installationId:i.id,action:'suspend',reason:'Fixture suspension'});await assert.rejects(proof(f,i,f.now+1,'presence'),/unavailable/);
    f.licensing.moderate('admin',{installationId:i.id,action:'resume',reason:'Fixture resumption'});assert.equal(f.store.get('SELECT generation FROM licenses WHERE id=?',f.license.id).generation,1);
    f.licensing.moderate('admin',{installationId:i.id,action:'revoke',reason:'Fixture revocation'});await assert.rejects(proof(f,i,f.now+2,'presence'),/unavailable/);assert.equal(f.store.all('SELECT * FROM audit WHERE action LIKE ?', 'installation.%').length,4);
  }finally{await f.close();}
});
test('two independent SQLite connections race at first activation: one period, one writer and one pending request',async()=>{
  const f=await fixture();try{
    const first=await identity(f),second=await identity(f),inputs=await Promise.all([proof(f,first,f.now),proof(f,second,f.now)]),barrier=new SharedArrayBuffer(4);
    const workers=inputs.map(input=>new Worker(new URL('./fixtures/activation-worker.mjs',import.meta.url),{workerData:{filename:f.filename,signer:f.signer,session:f.session,input,now:f.now,barrier}}));
    const exits=workers.map(worker=>new Promise(resolve=>worker.once('exit',resolve)));
    const results=workers.map(worker=>new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',message=>{if(message.ready)return;resolve(message);});}));
    await Promise.all(workers.map(worker=>new Promise(resolve=>worker.once('message',resolve))));Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0,2);
    const rows=await Promise.all(results);assert.equal(rows.filter(/** @param {any} r */r=>r.result?.pending===false).length,1);assert.equal(rows.filter(/** @param {any} r */r=>r.result?.pending===true).length,1);
    const license=f.store.get('SELECT * FROM licenses WHERE id=?',f.license.id);assert.equal(license.starts_at,f.now);assert.equal(license.ends_at,f.now+365*86400000);assert.equal(license.generation,1);
    await Promise.all(exits);
  }finally{await f.close();}
});
test('service API requires session + CSRF, admin MFA and owner authorization; response never contains password hashes',async()=>{
  const f=await fixture(),secret=token(),encryptionKey=randomBytes(32),totp=randomBytes(20),review=token();
  f.store.run('INSERT INTO accounts(id,username,password_hash,role,totp_encrypted,created_at) VALUES(?,?,?,?,?,?)','admin-A','fixture-admin',await passwordHash(secret),'owner',encrypt(totp.toString('base64url'),encryptionKey),f.now);
  const app=await createApp({distDirectory:fileURLToPath(new URL('../dist',import.meta.url)),stagingHash:stagingDigest('review',review),registerApi:app=>registerServiceApi(app,{store:f.store,licensing:f.licensing,encryptionKey,secureCookies:false,now:()=>f.now})});
  const authorization='Basic '+Buffer.from('review:'+review).toString('base64');
  try{
    assert.equal((await app.inject({url:'/api/admin/overview',headers:{authorization}})).statusCode,401);
    const bad=await app.inject({method:'POST',url:'/api/session/login',headers:{authorization},payload:{username:'fixture-admin',password:secret}});assert.equal(bad.statusCode,401);
    const login=await app.inject({method:'POST',url:'/api/session/login',headers:{authorization},payload:{username:'fixture-admin',password:secret,otp:otpAt(totp,Math.floor(f.now/30000))}});assert.equal(login.statusCode,200,login.body);
    const cookie=login.cookies.map(c=>c.name+'='+c.value).join(';'),csrf=login.json().csrfToken;
    assert.equal((await app.inject({method:'POST',url:'/api/admin/accounts',headers:{authorization,cookie},payload:{username:'fixture-new',customerName:'Fixture',storeName:'Fixture shop',reason:'Test create'}})).statusCode,403);
    const created=await app.inject({method:'POST',url:'/api/admin/accounts',headers:{authorization,cookie,'x-csrf-token':csrf},payload:{username:'fixture-new',customerName:'Fixture',storeName:'Fixture shop',reason:'Test create'}});assert.equal(created.statusCode,200,created.body);
    const overview=await app.inject({url:'/api/admin/overview',headers:{authorization,cookie}});assert.equal(overview.statusCode,200);assert.equal(overview.body.includes('password_hash'),false);assert.equal(overview.body.includes('totp_encrypted'),false);
    const headers={authorization,cookie,'x-csrf-token':csrf};
    const edited=await app.inject({method:'POST',url:'/api/admin/edit-customer',headers,payload:{accountId:created.json().id,username:'fixture-renamed',customerName:'Updated customer',storeName:'Updated store',reason:'Fixture customer correction'}});assert.equal(edited.statusCode,200,edited.body);assert.equal(f.store.get('SELECT username FROM accounts WHERE id=?',created.json().id).username,'fixture-renamed');
    const terms=f.store.get('SELECT duration_ms FROM licenses WHERE id=?',f.license.id).duration_ms;
    const plan=await app.inject({method:'POST',url:'/api/admin/edit-plan',headers,payload:{planId:'plan-A',name:'Updated future plan',durationMs:86400000,priceMinor:12345,currency:'MRU',offlineMs:null,enabled:true,reason:'Fixture future pricing update'}});assert.equal(plan.statusCode,200,plan.body);assert.equal(f.store.get('SELECT duration_ms FROM licenses WHERE id=?',f.license.id).duration_ms,terms);
    f.store.atomic(()=>{for(let n=0;n<520;n++){f.store.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)','bulk-'+n,'bulk-'+String(n).padStart(4,'0'),'fixture-no-login','customer',f.now+n);f.store.run('INSERT INTO shops VALUES(?,?,?,?)','bulk-shop-'+n,'bulk-'+n,'needle-'+n,'Synthetic customer');}});
    const search=await app.inject({method:'POST',url:'/api/admin/search',headers,payload:{query:'needle-0',cursor:0,limit:50}});assert.equal(search.statusCode,200,search.body);assert.equal(search.json().data.accounts[0].id,'bulk-0');assert.equal(search.body.includes('password_hash'),false);
    const page=await app.inject({method:'POST',url:'/api/admin/search',headers,payload:{query:'',cursor:0,limit:50}});assert.equal(page.json().data.accounts.length,50);assert.equal(page.json().nextCursor,50);assert.ok(page.json().total>500);
    f.store.run('INSERT INTO accounts(id,username,password_hash,role,totp_encrypted,created_at) VALUES(?,?,?,?,?,?)','support-A','fixture-support',await passwordHash(secret),'support',encrypt(totp.toString('base64url'),encryptionKey),f.now);
    const support=await app.inject({method:'POST',url:'/api/session/login',headers:{authorization},payload:{username:'fixture-support',password:secret,otp:otpAt(totp,Math.floor(f.now/30000))}});assert.equal(support.statusCode,200,support.body);const supportHeaders={authorization,cookie:support.cookies.map(c=>c.name+'='+c.value).join(';'),'x-csrf-token':support.json().csrfToken};
    const metadata=await app.inject({method:'POST',url:'/api/admin/search',headers:supportHeaders,payload:{query:'',cursor:0,limit:50}});assert.equal(metadata.statusCode,200);assert.deepEqual(metadata.json().data.payments,[]);assert.equal((await app.inject({method:'POST',url:'/api/admin/reset-access',headers:supportHeaders,payload:{accountId:'customer-A',reason:'Unauthorized support attempt'}})).statusCode,403);
    const replay=await app.inject({method:'POST',url:'/api/session/login',headers:{authorization},payload:{username:'fixture-admin',password:secret,otp:otpAt(totp,Math.floor(f.now/30000))}});assert.equal(replay.statusCode,401);
  }finally{await app.close();await f.close();}
});
