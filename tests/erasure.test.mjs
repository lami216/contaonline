import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, copyFile } from 'node:fs/promises';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServiceStore } from '../server/store.mjs';
import { Backups } from '../server/backups.mjs';
import { Licensing } from '../server/licensing.mjs';
import { ErasureLedger } from '../server/erasure-ledger.mjs';
import { AccountErasure } from '../server/erasure.mjs';
import { erasureScope, eraseRows, accountFolder } from '../server/erasure-data.mjs';
import { snapshotService, restoreService } from '../server/recovery.mjs';
import { passwordHash, encrypt, otpAt, digest } from '../server/security.mjs';
import { createApp, stagingDigest } from '../server/app.mjs';
import { registerServiceApi } from '../server/api.mjs';
async function fixture(){
  const base=path.resolve(process.env.TEST_TMPDIR||tmpdir()),root=await mkdtemp(path.join(base,'contaonline-erasure-')),directory=path.join(root,'backups'),store=new ServiceStore(path.join(root,'service.sqlite')),ledgerFile=path.join(root,'privacy-ledger.sqlite'),ledger=new ErasureLedger(ledgerFile),erasure=new AccountErasure(store,ledger,directory);
  let time=1900000000000;
  const password=randomBytes(24).toString('base64url'),hash=await passwordHash(password),codes={A:randomBytes(32).toString('base64url'),B:randomBytes(32).toString('base64url')},encryptionKey=randomBytes(32),totp=randomBytes(20),pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),licensing=new Licensing(store,{kid:'erasure-fixture',privateJwk:pair.privateKey.export({format:'jwk'}),publicKeys:{'erasure-fixture':pair.publicKey.export({format:'jwk'})}});
  const backups=new Backups(store,licensing,directory);
  for(const role of ['owner','support'])store.run('INSERT INTO accounts(id,username,password_hash,role,totp_encrypted,created_at) VALUES(?,?,?,?,?,?)',role,'fixture-'+role,hash,role,encrypt(totp.toString('base64url'),encryptionKey),time);
  store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)','app-plan','Synthetic app','app',86400000,100,'MRU',null);store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)','backup-plan','Synthetic backup','backup',86400000,100,'MRU',null);
  /** @type {Record<string,{app:string,installation:string,version:string,file:string,content:string}>} */const records={};
  for(const id of /** @type {const} */(['A','B'])){
    store.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)',id,'unique-erasure-fixture-'+id.toLowerCase(),hash,'customer',time);store.run('INSERT INTO privacy_owner_credentials VALUES(?,?,1)',id,await passwordHash(codes[id]));store.run('INSERT INTO shops VALUES(?,?,?,?)','shop-'+id,id,'Shop sentinel '+id,'Owner sentinel '+id);
    const app=store.issueLicense('owner',{shopId:'shop-'+id,planId:'app-plan',reason:'Synthetic issue '+id,paymentReference:'TEST-'+id},time),backup=store.issueLicense('owner',{shopId:'shop-'+id,planId:'backup-plan',reason:'Synthetic backup '+id,paymentReference:'TEST-'+id},time),installation=randomUUID(),stream=randomUUID(),version=randomUUID(),file=path.join(directory,accountFolder(id),version+'.json'),content='PRIVATE-ACCOUNTING-SENTINEL-'+id;
    backups.consent({account_id:id,role:'customer'},{shopId:'shop-'+id,backupLicenseId:backup.id,enabled:true,policyVersion:1},time);
    store.run('INSERT INTO installations VALUES(?,?,?,?,?,?,?,?,?)',installation,id,app.id,'fingerprint-'+id,'{}','approved',time,time,time);store.run('INSERT INTO presence VALUES(?,?,?,?,?)',installation,time,time+300000,null,null);store.run('INSERT INTO incidents VALUES(?,?,?,?,NULL)',randomUUID(),app.id,'fixture',time);
    store.run('INSERT INTO backup_streams VALUES(?,?,?,?,?,?,?,?)',stream,id,'shop-'+id,app.id,installation,1,1,version);store.run('INSERT INTO backup_events VALUES(?,?,?,?)',stream,1,randomUUID(),'fixture');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);store.run('INSERT INTO backup_versions VALUES(?,?,?,?,?,?,?,?,?,?)',version,stream,'shop-'+id,id,1,digest(content),Buffer.byteLength(content),file,time,'ready');
    const payment=randomUUID();store.run('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)',payment,app.id,100,'MRU',time,'PRIVATE-PAYMENT-'+id,'Private payment note '+id,'owner',time);store.audit('owner','payment.record',payment,'Private payment reason '+id,'PRIVATE-PAYMENT-'+id,{},time);store.audit('owner','fixture.related-metadata','global','Synthetic structured relation','',{nested:{accountId:id}},time);
    records[id]={app:app.id,installation,version,file,content};
  }
  const keyFile=path.join(root,'archive.key'),configFile=path.join(root,'config.json'),archive=path.join(root,'managed.enc');await writeFile(keyFile,randomBytes(32));await writeFile(configFile,JSON.stringify({database:path.join(root,'service.sqlite'),backupDirectory:directory,privacyLedgerFile:ledgerFile,encryptionKey:encryptionKey.toString('base64url')}));
  const authorization='Basic '+Buffer.from('fixture-review:fixture-secret').toString('base64'),app=await createApp({distDirectory:fileURLToPath(new URL('../dist',import.meta.url)),stagingHash:stagingDigest('fixture-review','fixture-secret'),registerApi:app=>registerServiceApi(app,{store,licensing,backups,erasure,encryptionKey,secureCookies:false,now:()=>time})});
  /** @param {string} id @param {boolean} privacy */
  async function login(id,privacy=true){const response=await app.inject({method:'POST',url:privacy?'/api/privacy/login':'/api/session/login',headers:{authorization},payload:{username:id==='A'||id==='B'?'unique-erasure-fixture-'+id:'fixture-'+id,password,...(['owner','support'].includes(id)?{otp:otpAt(totp,Math.floor(time/30000))}:{})}});assert.equal(response.statusCode,200,response.body);return {authorization,cookie:response.cookies.map(c=>c.name+'='+c.value).join(';'),'x-csrf-token':response.json().csrfToken};}
  return {root,base,directory,store,ledger,ledgerFile,erasure,records,codes,password,keyFile,configFile,archive,app,authorization,login,now:()=>time,advance(/** @type {number} */ms){time+=ms;},async close(){await app.close();store.close();ledger.close();assert.ok(root.startsWith(base+path.sep));await rm(root,{recursive:true,force:true});}};
}
test('actual erasure removes owned financial records, files, audit and managed archives; another institution and payment behavior survive; old archive cannot resurrect account',async()=>{
  const f=await fixture();try{
    await snapshotService(f.configFile,f.archive,f.keyFile);const old=path.join(f.root,'unmanaged-old.enc');await copyFile(f.archive,old);
    const stale=path.join(f.root,'previously-restored');await restoreService(old,stale,f.keyFile,f.ledgerFile);
    const scratch=path.join(f.root,'.conta-recovery-interrupted');await mkdir(scratch);await writeFile(path.join(scratch,'private-copy'),'PRIVATE-ACCOUNTING-SENTINEL-A');f.ledger.db.prepare('INSERT INTO scratch VALUES(?,?,?)').run(scratch,f.root,99999999);
    const orphan=path.join(path.dirname(f.records.A.file),randomUUID()+'.json');await writeFile(orphan,'Synthetic crash orphan A');
    const beforeB=f.store.all('SELECT l.* FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=?','B');
    const headers=await f.login('A'),authority={currentPassword:f.password,ownerCode:f.codes.A,confirm:true};
    const preview=await f.app.inject({method:'POST',url:'/api/privacy/erasure/preview',headers,payload:authority});assert.equal(preview.statusCode,200,preview.body);assert.equal(preview.json().counts.payments,1);assert.equal(preview.json().managedArchives,1);
    const receipt=preview.json().receipt,response=await f.app.inject({method:'POST',url:'/api/privacy/erasure/confirm',headers,payload:{...authority,receipt,confirmation:'DELETE'}});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().state,'complete');
    for(const table of ['accounts','shops','licenses','payments','installations','presence','incidents','backup_consents','backup_streams','backup_events','backup_versions','privacy_owner_credentials','privacy_erasure_previews'])assert.equal(f.store.get('SELECT COUNT(*) AS n FROM '+table).n,table==='accounts'?3:table==='licenses'?2:table==='privacy_erasure_previews'?0:1,table);
    assert.equal(f.store.get('SELECT id FROM accounts WHERE id=?','A'),undefined);assert.equal(f.store.all('SELECT * FROM sessions').length,0);assert.equal(f.store.all('SELECT * FROM audit').some(row=>row.actor_id==='A'||row.reason.includes(' A')||row.payment_reference==='PRIVATE-PAYMENT-A'||row.metadata.includes('"A"')),false);
    assert.throws(()=>f.store.run('DELETE FROM audit'),/append only/);assert.deepEqual(f.store.all('SELECT l.* FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=?','B'),beforeB);
    await assert.rejects(access(f.records.A.file));await assert.rejects(access(orphan));assert.equal(await readFile(f.records.B.file,'utf8'),f.records.B.content);
    await assert.rejects(access(scratch));
    const main=await readFile(path.join(f.root,'service.sqlite'));assert.equal(main.includes(Buffer.from('Owner sentinel A')),false);assert.equal(main.includes(Buffer.from('PRIVATE-PAYMENT-A')),false);
    assert.equal(f.ledger.pending().length,0);assert.equal(f.ledger.db.prepare('SELECT account_id FROM jobs').get()?.account_id,null);assert.equal(f.ledger.has('account','A'),true);
    for(const [archive,name]of [[f.archive,'clean-restore'],[old,'old-restore']]){const target=path.join(f.root,name);await restoreService(archive,target,f.keyFile,f.ledgerFile);const restored=new ServiceStore(path.join(target,'service.sqlite'));try{assert.equal(restored.get('SELECT id FROM accounts WHERE id=?','A'),undefined);assert.equal(restored.get('SELECT id FROM accounts WHERE id=?','B').id,'B');assert.equal(restored.get('SELECT COUNT(*) AS n FROM payments').n,1);}finally{restored.close();}await assert.rejects(access(path.join(target,'backups',f.records.A.version+'.json')));assert.equal(await readFile(path.join(target,'backups',f.records.B.version+'.json'),'utf8'),f.records.B.content);}
    const staleStore=new ServiceStore(path.join(stale,'service.sqlite'));try{assert.equal(staleStore.get('SELECT id FROM accounts WHERE id=?','A').id,'A');new AccountErasure(staleStore,f.ledger,path.join(stale,'backups')).reconcileRestored();assert.equal(staleStore.get('SELECT id FROM accounts WHERE id=?','A'),undefined);assert.equal(staleStore.get('SELECT id FROM accounts WHERE id=?','B').id,'B');}finally{staleStore.close();}
    const activity=await f.app.inject({method:'POST',url:'/api/activity/challenge',headers:{authorization:f.authorization},payload:{licenseId:f.records.A.app,installationId:f.records.A.installation}});assert.equal(activity.statusCode,410);
    const status=await f.app.inject({method:'POST',url:'/api/privacy/erasure/status',headers:{authorization:f.authorization},payload:{receipt}});assert.equal(status.json().state,'complete');
    await assert.rejects(restoreService(old,path.join(f.root,'no-ledger'),f.keyFile,''),/ledger required/);
    const other=new ErasureLedger(path.join(f.root,'wrong-ledger.sqlite'));other.close();await assert.rejects(restoreService(old,path.join(f.root,'wrong-ledger'),f.keyFile,path.join(f.root,'wrong-ledger.sqlite')),/matching erasure ledger/);
  }finally{await f.close();}
});
test('cashier/service password alone, another owner code, missing CSRF, cross-account receipt, expired preview and rotated authority cannot delete',async()=>{
  const f=await fixture();try{
    const headers=await f.login('A'),bHeaders=await f.login('B'),normal=await f.login('A',false),body={currentPassword:f.password,ownerCode:f.codes.A,confirm:true};
    /** @param {string} route @param {any} payload @param {Record<string,string>} h */const send=(route,payload,h=headers)=>f.app.inject({method:'POST',url:'/api/privacy/erasure/'+route,headers:h,payload});
    assert.equal((await send('preview',body,normal)).statusCode,401);assert.equal((await send('preview',body,{...headers,'x-csrf-token':''})).statusCode,403);assert.equal((await send('preview',{...body,ownerCode:f.codes.B})).statusCode,403);assert.equal((await send('preview',{...body,ownerCode:''})).statusCode,400);
    const receipt=(await send('preview',body)).json().receipt;assert.equal((await send('confirm',{...body,ownerCode:f.codes.B,receipt,confirmation:'DELETE'},bHeaders)).statusCode,409);assert.equal((await send('confirm',{...body,receipt,confirmation:'delete'})).statusCode,400);
    f.advance(300001);assert.equal((await send('confirm',{...body,receipt,confirmation:'DELETE'})).statusCode,409);f.advance(900000);
    const next=(await send('preview',body)).json().receipt;f.store.run('UPDATE privacy_owner_credentials SET version=version+1 WHERE account_id=?','A');assert.equal((await send('confirm',{...body,receipt:next,confirmation:'DELETE'})).statusCode,409);
    assert.equal(f.ledger.pending().length,0);assert.equal(f.store.get('SELECT disabled FROM accounts WHERE id=?','A').disabled,0);assert.equal(await readFile(f.records.A.file,'utf8'),f.records.A.content);
  }finally{await f.close();}
});
test('archive failure never reports completion; access stays revoked and a fresh worker resumes from durable receipt after rows have gone',async()=>{
  const f=await fixture();try{
    await snapshotService(f.configFile,f.archive,f.keyFile);const original=await readFile(f.archive);await writeFile(f.archive,'Synthetic broken archive');
    const preview=f.erasure.preview('A',1,1,f.now());f.erasure.confirm('A',preview.receipt,1,1,f.now());await f.erasure.resume();assert.equal(f.ledger.status(preview.receipt)?.state,'pending');assert.equal(f.store.get('SELECT id FROM accounts WHERE id=?','A'),undefined);assert.equal(f.ledger.files(f.ledger.hash(preview.receipt)).length,1);
    await writeFile(f.archive,original);const reopened=new ErasureLedger(f.ledgerFile,false);try{await new AccountErasure(f.store,reopened,f.directory).resume();assert.equal(reopened.status(preview.receipt)?.state,'complete');assert.equal(await readFile(f.records.B.file,'utf8'),f.records.B.content);}finally{reopened.close();}
  }finally{await f.close();}
});
test('scoped erasure transaction restores the audit guard and rows on an unexpected foreign-key failure',async()=>{
  const f=await fixture();try{
    f.store.db.exec('CREATE TABLE future_owned_data(account_id TEXT REFERENCES accounts(id))');f.store.run('INSERT INTO future_owned_data VALUES(?)','A');const before=f.store.all('SELECT * FROM audit');assert.throws(()=>eraseRows(f.store,erasureScope(f.store,'A')),/FOREIGN KEY/);assert.deepEqual(f.store.all('SELECT * FROM audit'),before);assert.throws(()=>f.store.run('DELETE FROM audit'),/append only/);assert.equal(f.store.get('SELECT id FROM accounts WHERE id=?','A').id,'A');
  }finally{await f.close();}
});
test('only MFA platform owner can provision a separate business-owner code; codes are returned once, hashed, rotate previews and do not change service passwords',async()=>{
  const f=await fixture();try{
    const owner=await f.login('owner',false),support=await f.login('support',false),customer=await f.login('A',false),before=f.store.get('SELECT password_hash FROM accounts WHERE id=?','A').password_hash,preview=f.erasure.preview('A',1,1,f.now());
    assert.equal((await f.app.inject({url:'/api/admin/erasures',headers:owner})).statusCode,200);for(const headers of [support,customer])assert.equal((await f.app.inject({url:'/api/admin/erasures',headers})).statusCode,403);
    for(const headers of [support,customer])assert.equal((await f.app.inject({method:'POST',url:'/api/admin/owner-code',headers,payload:{accountId:'A',reason:'Synthetic verified ownership'}})).statusCode,403);
    const provision=await f.app.inject({method:'POST',url:'/api/admin/owner-code',headers:owner,payload:{accountId:'A',reason:'Synthetic verified ownership'}});assert.equal(provision.statusCode,200,provision.body);assert.ok(provision.json().ownerCode);assert.notEqual(provision.json().ownerCode,f.codes.A);assert.equal(f.store.get('SELECT password_hash FROM accounts WHERE id=?','A').password_hash,before);assert.equal(f.store.get('SELECT version FROM privacy_owner_credentials WHERE account_id=?','A').version,2);assert.equal(f.store.get('SELECT nonce_hash FROM privacy_erasure_previews WHERE nonce_hash=?',digest(preview.receipt)),undefined);assert.equal(JSON.stringify(f.store.all('SELECT * FROM audit')).includes(provision.json().ownerCode),false);
  }finally{await f.close();}
});
test('a reader holding the old WAL prevents a false completed receipt; closing it permits scrub and retry',async()=>{
  const f=await fixture(),reader=new ServiceStore(path.join(f.root,'service.sqlite'));try{
    f.store.db.exec('PRAGMA busy_timeout=20');reader.db.exec('BEGIN');assert.equal(reader.get('SELECT id FROM accounts WHERE id=?','A').id,'A');const preview=f.erasure.preview('A',1,1,f.now());f.erasure.confirm('A',preview.receipt,1,1,f.now());await f.erasure.resume();assert.equal(f.ledger.status(preview.receipt)?.state,'pending');assert.equal(f.ledger.overview()[0].stage,'records');reader.db.exec('COMMIT');await f.erasure.resume();assert.equal(f.ledger.status(preview.receipt)?.state,'complete');
  }finally{reader.close();await f.close();}
});
test('unknown legacy flat files and unsafe owned paths block completion without erasing an unrelated file',async()=>{
  const f=await fixture();try{
    const unknown=path.join(f.directory,randomUUID()+'.json');await writeFile(unknown,'Synthetic unowned legacy crash copy');const preview=f.erasure.preview('A',1,1,f.now());f.erasure.confirm('A',preview.receipt,1,1,f.now());await f.erasure.resume();assert.equal(f.ledger.status(preview.receipt)?.state,'pending');assert.equal(f.store.get('SELECT disabled FROM accounts WHERE id=?','A').disabled,1);assert.equal(await readFile(unknown,'utf8'),'Synthetic unowned legacy crash copy');await rm(unknown);
    const outside=path.join(f.root,'must-never-delete.json');await writeFile(outside,'Unrelated private sentinel');f.ledger.db.prepare('UPDATE files SET path=? WHERE receipt_hash=?').run(outside,f.ledger.hash(preview.receipt));await f.erasure.resume();assert.equal(f.ledger.status(preview.receipt)?.state,'pending');assert.equal(await readFile(outside,'utf8'),'Unrelated private sentinel');f.ledger.db.prepare('UPDATE files SET path=? WHERE receipt_hash=?').run(f.records.A.file,f.ledger.hash(preview.receipt));await f.erasure.resume();assert.equal(f.ledger.status(preview.receipt)?.state,'complete');
  }finally{await f.close();}
});
