import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { ServiceStore } from '../server/store.mjs';
import { Licensing } from '../server/licensing.mjs';
import { Backups } from '../server/backups.mjs';
import { applyDelta, diffSnapshot } from '../shared/backup.mjs';
const validationModule='../approved-runtime/database.js';const {validateState}=await import(validationModule);
/** @returns {{format:string,schemaVersion:number,state:Record<string,any>,users:any[]}} */
function snapshot(){return {format:'contaonline-backup',schemaVersion:1,state:{opening:{},products:[],parties:[],accounts:[],records:[],warehouses:['main'],branding:'Fixture'},users:[{id:'local-fixture-owner',username:'owner',role:'owner',active:true,password:{salt:'a'.repeat(32),hash:'b'.repeat(64)}}]};}
async function fixture(){
  const directory=await mkdtemp(path.join(tmpdir(),'contaonline-backups-')),store=new ServiceStore(path.join(directory,'service.sqlite')),now=1900000000000,session={account_id:'customer-A',role:'customer'},installationId=randomUUID();
  store.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)',session.account_id,'fixture','fixture','customer',now);store.run('INSERT INTO shops VALUES(?,?,?,?)','shop-A',session.account_id,'Fixture','Fixture');
  store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)','app-plan','Fixture app','app',86400000,1,'MRU',null);store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)','backup-plan','Fixture backup','backup',2*86400000,1,'MRU',null);
  const app=store.issueLicense('admin',{shopId:'shop-A',planId:'app-plan',reason:'Fixture approval',paymentReference:'fixture'},now),backup=store.issueLicense('admin',{shopId:'shop-A',planId:'backup-plan',reason:'Fixture backup approval',paymentReference:'fixture'},now);
  store.run('UPDATE licenses SET starts_at=?,ends_at=?,writer_id=?,generation=1 WHERE id=?',now,now+86400000,installationId,app.id);
  store.run('INSERT INTO installations(id,account_id,license_id,fingerprint,public_jwk,status,first_at) VALUES(?,?,?,?,?,?,?)',installationId,session.account_id,app.id,'fixture','{}','approved',now);
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),signer={privateJwk:pair.privateKey.export({format:'jwk'}),kid:'fixture',publicKeys:{fixture:pair.publicKey.export({format:'jwk'})}},licensing=new Licensing(store,signer),backups=new Backups(store,licensing,path.join(directory,'private-backups'));
  return {directory,store,now,session,installationId,app,backup,backups,signer,async close(){store.close();assert.ok(directory.startsWith(tmpdir()+path.sep));await rm(directory,{recursive:true,force:true});}};
}
/** @param {Awaited<ReturnType<typeof fixture>>} f */
function open(f){f.backups.consent(f.session,{shopId:'shop-A',backupLicenseId:f.backup.id,enabled:true,policyVersion:1},f.now);const streamId=randomUUID();f.backups.openStream(f.session,{appLicenseId:f.app.id,installationId:f.installationId,generation:1,streamId},f.now);return streamId;}
test('versioned delta reconstructs edits/deletes/order without mutating source or treating a whole shop as a sale event',()=>{
  const before=snapshot();before.state.products=[{id:1,name:'A',price:10,cost:5,stocks:{main:2}},{id:2,name:'B',price:20,cost:9,stocks:{main:1}}];const next=structuredClone(before);next.state.products=[{...next.state.products[1],price:25}];next.state.branding='Updated';const copy=structuredClone(before),ops=diffSnapshot(before,next);assert.deepEqual(applyDelta(before,ops,validateState),next);assert.deepEqual(before,copy);assert.ok(ops.some(op=>op.op==='remove'));assert.ok(ops.some(op=>op.op==='upsert'));assert.throws(()=>applyDelta(before,[{op:'set',key:'__proto__',value:{}}],validateState));
});
test('backup requires separate entitlement and consent; retry after lost ACK is idempotent and corrupted deltas preserve last version',async()=>{
  const f=await fixture();try{
    assert.throws(()=>f.backups.openStream(f.session,{appLicenseId:f.app.id,installationId:f.installationId,generation:1,streamId:randomUUID()},f.now),/entitled/);
    const streamId=open(f),base={id:randomUUID(),sequence:1,kind:'snapshot',snapshot:snapshot()},ack=f.backups.receive(f.session,{streamId,events:[base]},f.now);assert.equal(ack.durable,true);assert.deepEqual(f.backups.receive(f.session,{streamId,events:[base]},f.now+1),ack);assert.equal(f.store.all('SELECT * FROM backup_versions').length,1);
    const next=snapshot();next.state.branding='Delta';const delta={id:randomUUID(),sequence:2,kind:'delta',operations:diffSnapshot(snapshot(),next)},second=f.backups.receive(f.session,{streamId,events:[delta]},f.now+2);assert.equal(second.cursor,2);assert.deepEqual(f.backups.download(f.session,second.versionId,f.now+3).snapshot,next);
    assert.throws(()=>f.backups.receive(f.session,{streamId,events:[{...delta,id:randomUUID()}]},f.now+3),/Conflicting/);
    assert.throws(()=>f.backups.receive(f.session,{streamId,events:[{id:randomUUID(),sequence:3,kind:'delta',operations:[{op:'set',key:'products',value:'corrupt'}]}]},f.now+4));assert.equal(f.store.get('SELECT cursor FROM backup_streams WHERE id=?',streamId).cursor,2);assert.deepEqual(f.backups.download(f.session,second.versionId,f.now+5).snapshot,next);
    assert.throws(()=>f.backups.download({...f.session,account_id:'customer-B'},second.versionId,f.now+5),/Unavailable/);assert.throws(()=>f.backups.download({...f.session,role:'support'},second.versionId,f.now+5),/permission/);
    f.store.run('UPDATE licenses SET generation=2 WHERE id=?',f.app.id);assert.throws(()=>f.backups.receive(f.session,{streamId,events:[delta]},f.now+6),/authority/);
  }finally{await f.close();}
});
test('app and backup expiry are independent; expiry grace allows download only, and audited retention never runs on a state change',async()=>{
  const f=await fixture();try{const streamId=open(f),event={id:randomUUID(),sequence:1,kind:'snapshot',snapshot:snapshot()},ack=f.backups.receive(f.session,{streamId,events:[event]},f.now);
    const appExpired=f.now+86400001;assert.equal(f.backups.receive(f.session,{streamId,events:[event]},appExpired).durable,true);
    const backupExpired=f.now+2*86400000+1;assert.throws(()=>f.backups.receive(f.session,{streamId,events:[event]},backupExpired),/entitled/);assert.ok(f.backups.download(f.session,ack.versionId,backupExpired).snapshot);
    const afterGrace=f.now+33*86400000;assert.throws(()=>f.backups.download(f.session,ack.versionId,afterGrace),/entitled/);assert.equal(f.store.get('SELECT status FROM backup_versions WHERE id=?',ack.versionId).status,'ready');
    const auditCount=f.store.all('SELECT * FROM audit').length;f.backups.prune({dryRun:true,now:backupExpired});assert.equal(f.store.all('SELECT * FROM audit').length,auditCount);
    f.backups.prune({dryRun:false,now:backupExpired});assert.equal(f.store.get('SELECT status FROM backup_versions WHERE id=?',ack.versionId).status,'ready');
    assert.deepEqual(f.backups.prune({dryRun:false,now:afterGrace}).deleted,[ack.versionId]);assert.equal(f.store.get('SELECT status FROM backup_versions WHERE id=?',ack.versionId).status,'deleted');assert.equal(f.store.all('SELECT * FROM audit WHERE action=?','backup.deleted').length,1);
  }finally{await f.close();}
});
test('checksum corruption and an unconfirmed replacement stream cannot overwrite a valid backup',async()=>{
  const f=await fixture();try{const streamId=open(f),ack=f.backups.receive(f.session,{streamId,events:[{id:randomUUID(),sequence:1,kind:'snapshot',snapshot:snapshot()}]},f.now);
    assert.throws(()=>f.backups.openStream(f.session,{appLicenseId:f.app.id,installationId:f.installationId,generation:1,streamId:randomUUID()},f.now),/Review latest/);
    const version=f.store.get('SELECT * FROM backup_versions WHERE id=?',ack.versionId);await writeFile(version.path,'corrupt fixture');assert.throws(()=>f.backups.download(f.session,ack.versionId,f.now+1),/integrity/);assert.equal(f.store.get('SELECT cursor FROM backup_streams WHERE id=?',streamId).cursor,1);
  }finally{await f.close();}
});
test('upload and administrative writer transfer race on separate SQLite connections; old generation never overwrites the approved stream',async()=>{
  const f=await fixture();try{
    const streamId=open(f);f.backups.receive(f.session,{streamId,events:[{id:randomUUID(),sequence:1,kind:'snapshot',snapshot:snapshot()}]},f.now);
    const replacement=randomUUID();f.store.run('INSERT INTO installations(id,account_id,license_id,fingerprint,public_jwk,status,first_at) VALUES(?,?,?,?,?,?,?)',replacement,f.session.account_id,f.app.id,'replacement-fixture','{}','approved',f.now);
    const oldNext=snapshot();oldNext.state.branding='old-writer-before-transfer';const event={id:randomUUID(),sequence:2,kind:'delta',operations:diffSnapshot(snapshot(),oldNext)},barrier=new SharedArrayBuffer(4);
    const jobs=[{kind:'upload',input:{streamId,events:[event]}},{kind:'moderate',input:{installationId:replacement,action:'allow',reason:'Synthetic concurrent writer transfer'}}];
    const workers=jobs.map(job=>new Worker(new URL('./fixtures/backup-race-worker.mjs',import.meta.url),{workerData:{...job,filename:path.join(f.directory,'service.sqlite'),directory:path.join(f.directory,'private-backups'),signer:f.signer,session:f.session,now:f.now+1,barrier}}));
    const exits=workers.map(worker=>new Promise(resolve=>worker.once('exit',resolve))),results=workers.map(worker=>new Promise(/** @param {(value:any)=>void} resolve */(resolve,reject)=>{worker.on('error',reject);worker.on('message',message=>{if(!message.ready)resolve(message);});}));
    await Promise.all(workers.map(worker=>new Promise(resolve=>worker.once('message',resolve))));Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0,2);const [upload,moderation]=await Promise.all(results);await Promise.all(exits);
    assert.equal(moderation.result?.status,'approved');if(upload.result){const ack=f.store.get('SELECT id FROM audit WHERE action=? AND target_id=?','backup.ack',upload.result.versionId),grant=f.store.get('SELECT id FROM audit WHERE action=? AND target_id=?','installation.allow',replacement);assert.ok(ack.id<grant.id);}else assert.match(upload.error,/authority/);
    const current=snapshot();current.state.branding='current-writer';const currentStream=randomUUID(),latest=f.backups.latest('shop-A',f.session.account_id);f.backups.openStream(f.session,{appLicenseId:f.app.id,installationId:replacement,generation:2,streamId:currentStream,replaceVersionId:latest.id},f.now+2);const ack=f.backups.receive(f.session,{streamId:currentStream,events:[{id:randomUUID(),sequence:1,kind:'snapshot',snapshot:current}]},f.now+3);
    assert.throws(()=>f.backups.receive(f.session,{streamId,events:[event]},f.now+4),/authority/);assert.equal(f.backups.download(f.session,ack.versionId,f.now+5).snapshot.state.branding,'current-writer');
  }finally{await f.close();}
});
