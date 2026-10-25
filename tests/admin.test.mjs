import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes,generateKeyPairSync,randomUUID} from 'node:crypto';
import {ServiceStore} from '../server/store.mjs';
import {Licensing} from '../server/licensing.mjs';
import {Backups} from '../server/backups.mjs';
import {AdminReadModel} from '../server/admin-read.mjs';
import {PrivacyRequests} from '../server/privacy.mjs';
import {ErasureLedger} from '../server/erasure-ledger.mjs';
import {registerServiceApi} from '../server/api.mjs';
import {createApp,stagingDigest} from '../server/app.mjs';
import {passwordHash,encrypt,otpAt} from '../server/security.mjs';
const DAY=86400000;
async function fixture(){
  const root=await mkdtemp(path.join(process.env.TEST_TMPDIR||tmpdir(),'contaonline-admin-')),store=new ServiceStore(path.join(root,'service.sqlite')),now=1900000000000,password=randomBytes(24).toString('base64url'),hash=await passwordHash(password),encryptionKey=randomBytes(32),totp=randomBytes(20);
  for(const id of ['A','B','C']){store.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)',id,'fixture-'+id.toLowerCase(),hash,'customer',now);store.run('INSERT INTO shops VALUES(?,?,?,?)','shop-'+id,id,'Institution '+id,'Owner '+id);}
  store.run('INSERT INTO shops VALUES(?,?,?,?)','shop-A2','A','فرع الشرق','مالك الفرع');
  for(const role of ['owner','support'])store.run('INSERT INTO accounts(id,username,password_hash,role,totp_encrypted,created_at) VALUES(?,?,?,?,?,?)',role,'fixture-'+role,hash,role,encrypt(totp.toString('base64url'),encryptionKey),now);
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),licensing=new Licensing(store,{kid:'admin-fixture',privateJwk:pair.privateKey.export({format:'jwk'}),publicKeys:{'admin-fixture':pair.publicKey.export({format:'jwk'})}}),backups=new Backups(store,licensing,path.join(root,'backups')),read=new AdminReadModel(store,true);
  store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)','app-plan','Synthetic app','app',10*DAY,12345,'MRU',null);store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)','backup-plan','Synthetic backup','backup',10*DAY,900,'MRU',null);
  /** @type {Record<string,string>} */const licenseIds={};
  for(const id of ['A','B']){
    const app=store.issueLicense('owner',{shopId:'shop-'+id,planId:'app-plan',reason:'Synthetic approval '+id,paymentReference:'PRIVATE-PAYMENT-'+id,explicitStart:id==='A'?now-7*DAY:now-11*DAY},now),backup=store.issueLicense('owner',{shopId:'shop-'+id,planId:'backup-plan',reason:'Synthetic backup '+id,paymentReference:'BACKUP-'+id,explicitStart:now-DAY},now);licenseIds[id]=app.id;
    const device='device-'+id,stream=randomUUID(),version=randomUUID(),file=path.join(backups.directory,version+'.json');store.run('INSERT INTO installations VALUES(?,?,?,?,?,?,?,?,?)',device,id,app.id,'PRIVATE-FINGERPRINT-'+id,'{"PRIVATE-PUBLIC-KEY":true}','approved',now-DAY,now-100,now-DAY);store.run('UPDATE licenses SET writer_id=? WHERE id=?',device,app.id);store.run('INSERT INTO presence VALUES(?,?,?,?,?)',device,now-100,now+1000,null,null);
    store.run('INSERT INTO backup_consents VALUES(?,?,?,?,?,?,NULL)','shop-'+id,id,backup.id,1,1,now-DAY);store.run('INSERT INTO backup_streams VALUES(?,?,?,?,?,?,?,?)',stream,id,'shop-'+id,app.id,device,1,1,version);await writeFile(file,'PRIVATE-BACKUP-CONTENT-'+id);store.run('INSERT INTO backup_versions VALUES(?,?,?,?,?,?,?,?,?,?)',version,stream,'shop-'+id,id,1,'fixture-checksum',100,file,id==='A'?now-200:now-50,'ready');
    store.run('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)','payment-'+id,app.id,12345,'MRU',now,'PRIVATE-PAYMENT-'+id,'PRIVATE-NOTE-'+id,'owner',now);store.audit('owner','payment.record','payment-'+id,'PRIVATE-PAYMENT-REASON-'+id,'PRIVATE-PAYMENT-'+id,{},now);store.audit(id,'backup.failure',id,'Synthetic failure','',{operation:'upload'},now-100);
  }
  store.run('INSERT INTO installations VALUES(?,?,?,?,?,?,?,?,?)','pending-A','A',licenseIds.A,'PENDING-FINGERPRINT','{}','pending-conflict',now,null,null);store.run('INSERT INTO incidents VALUES(?,?,?,?,NULL)','incident-A',licenseIds.A,'overlap',now);
  const authorization='Basic '+Buffer.from('fixture-review:fixture-secret').toString('base64'),app=await createApp({distDirectory:fileURLToPath(new URL('../dist',import.meta.url)),stagingHash:stagingDigest('fixture-review','fixture-secret'),registerApi:app=>registerServiceApi(app,{store,licensing,backups,encryptionKey,secureCookies:false,now:()=>now})});
  /** @param {string} role */
  async function login(role){const response=await app.inject({method:'POST',url:'/api/session/login',headers:{authorization},payload:{username:'fixture-'+role,password,...(['owner','support'].includes(role)?{otp:otpAt(totp,Math.floor(now/30000))}:{})}});assert.equal(response.statusCode,200,response.body);return {authorization,cookie:response.cookies.map(c=>c.name+'='+c.value).join(';'),'x-csrf-token':response.json().csrfToken};}
  return {root,store,now,read,app,authorization,licenseIds,login,async close(){await app.close();store.close();await rm(root,{recursive:true,force:true});}};
}
test('directory searches every shop, excludes administrative accounts, classifies real expiry/device/backup state and paginates beyond 500',async()=>{
  const f=await fixture();try{
    const query={query:'',filter:'all',cursor:0,limit:25},before=f.store.all('SELECT * FROM licenses');let result=f.read.search(query,f.now);assert.equal(result.total,3);assert.equal(result.summary.total,3);assert.equal(result.summary.attention,3);assert.equal(result.summary.expiring,1);assert.equal(result.summary.devices,1);assert.equal(result.summary.backups,1);
    assert.deepEqual(f.read.search({...query,query:'فرع الشرق'},f.now).customers.map(a=>a.id),['A']);assert.deepEqual(f.read.search({...query,filter:'backups'},f.now).customers.map(a=>a.id),['A']);assert.deepEqual(f.read.search({...query,filter:'expiring'},f.now).customers.map(a=>a.id),['A']);assert.deepEqual(f.read.search({...query,filter:'devices'},f.now).customers.map(a=>a.id),['A']);assert.equal(result.customers.find(a=>a.id==='B').expiredApps,1);assert.equal(result.customers.find(a=>a.id==='B').backupFailure,0);
    f.store.atomic(()=>{for(let n=0;n<520;n++){f.store.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)','bulk-'+n,'bulk-'+String(n).padStart(4,'0'),'fixture-only','customer',f.now+n);f.store.run('INSERT INTO shops VALUES(?,?,?,?)','bulk-shop-'+n,'bulk-'+n,'Bulk '+n,'Synthetic');}});
    const ids=new Set();let cursor=0;do{result=f.read.search({...query,cursor,limit:100},f.now);for(const a of result.customers){assert.equal(ids.has(a.id),false);ids.add(a.id);}cursor=result.nextCursor??0;}while(result.nextCursor!==null);assert.equal(ids.size,523);assert.equal(result.total,523);assert.deepEqual(f.store.all('SELECT * FROM licenses'),before);
  }finally{await f.close();}
});
test('institution detail returns only that customer metadata and payments, with no keys, backup paths/content or another institution records',async()=>{
  const f=await fixture();try{
    new PrivacyRequests(f.store).request('A',1,f.now);const detail=f.read.customer('A',true,f.now),json=JSON.stringify(detail);assert.equal(detail.shops.length,2);assert.equal(detail.installations.length,2);assert.equal(detail.backups.length,2);assert.equal(detail.privacy.status,'requested');assert.deepEqual(detail.payments.map(p=>p.id),['payment-A']);assert.equal(detail.incidents[0].id,'incident-A');assert.ok(json.includes('PRIVATE-NOTE-A'));for(const text of ['Institution B','PRIVATE-NOTE-B','PRIVATE-PAYMENT-REASON-B','PRIVATE-FINGERPRINT-A','PRIVATE-PUBLIC-KEY','PRIVATE-BACKUP-CONTENT'])assert.equal(json.includes(text),false,text);assert.equal(/"(?:password_hash|totp_encrypted|code_hash|public_jwk|fingerprint|path|snapshot|checksum)"/.test(json),false);
    const support=f.read.customer('A',false,f.now);assert.deepEqual(support.payments,[]);assert.equal(support.privacy,null);assert.equal(support.ownerCode,null);assert.equal(support.audit.some(a=>a.action==='payment.record'),false);assert.throws(()=>f.read.customer('owner',true,f.now),/not found/);
  }finally{await f.close();}
});
test('new administration reads require MFA administration and search CSRF; scoped profile edit preserves other shops and rejects foreign-shop selection',async()=>{
  const f=await fixture();try{
    assert.equal((await f.app.inject({url:'/api/admin/customers/A',headers:{authorization:f.authorization}})).statusCode,401);const owner=await f.login('owner'),support=await f.login('support'),customer=await f.login('a');
    assert.equal((await f.app.inject({url:'/api/admin/customers/A',headers:customer})).statusCode,403);assert.equal((await f.app.inject({url:'/api/admin/customers/owner',headers:owner})).statusCode,404);assert.equal((await f.app.inject({url:'/api/admin/customers/absent',headers:owner})).statusCode,404);
    const payload={query:'',filter:'all',cursor:0,limit:25};assert.equal((await f.app.inject({method:'POST',url:'/api/admin/customers/search',headers:{...owner,'x-csrf-token':''},payload})).statusCode,403);assert.equal((await f.app.inject({method:'POST',url:'/api/admin/customers/search',headers:owner,payload})).json().total,3);
    const detail=await f.app.inject({url:'/api/admin/customers/A',headers:support});assert.equal(detail.statusCode,200);assert.deepEqual(detail.json().payments,[]);assert.equal((await f.app.inject({url:'/api/admin/catalog',headers:support})).statusCode,200);
    const profile={accountId:'A',shopId:'shop-A',username:'fixture-renamed',customerName:'Corrected owner',storeName:'Corrected shop',reason:'Synthetic scoped correction'};
    assert.equal((await f.app.inject({method:'POST',url:'/api/admin/edit-customer',headers:support,payload:profile})).statusCode,403);assert.equal((await f.app.inject({method:'POST',url:'/api/admin/edit-customer',headers:owner,payload:profile})).statusCode,200);assert.equal(f.store.get('SELECT name FROM shops WHERE id=?','shop-A').name,'Corrected shop');assert.equal(f.store.get('SELECT name FROM shops WHERE id=?','shop-A2').name,'فرع الشرق');
    assert.equal((await f.app.inject({method:'POST',url:'/api/admin/edit-customer',headers:owner,payload:{...profile,shopId:'shop-B',username:'must-not-save'}})).statusCode,400);assert.equal(f.store.get('SELECT username FROM accounts WHERE id=?','A').username,'fixture-renamed');assert.equal(f.store.get('SELECT name FROM shops WHERE id=?','shop-B').name,'Institution B');
  }finally{await f.close();}
});
test('older unfinished erasures stay visible ahead of more than 100 completed receipts and totals cover every job',async()=>{
  const root=await mkdtemp(path.join(process.env.TEST_TMPDIR||tmpdir(),'contaonline-admin-queue-')),ledger=new ErasureLedger(path.join(root,'ledger.sqlite'));
  try{
    const insert=ledger.db.prepare('INSERT INTO jobs(receipt_hash,account_id,state,counts,started_at,completed_at) VALUES(?,?,?,?,?,?)');
    for(let n=0;n<105;n++)insert.run('completed-'+n,null,'complete','{}',1000+n,2000+n);
    insert.run('old-pending-1','synthetic-A','pending','{}',1,null);insert.run('old-pending-2','synthetic-B','pending','{}',2,null);
    const rows=ledger.overview();assert.equal(rows.length,100);assert.equal(rows[0].reference,'old-pending-');assert.equal(rows[0].accountId,'synthetic-A');assert.equal(rows[1].accountId,'synthetic-B');assert.deepEqual({...ledger.summary()},{total:107,pending:2,complete:105});
  }finally{ledger.close();await rm(root,{recursive:true,force:true});}
});
