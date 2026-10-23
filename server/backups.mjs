import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { canonical } from '../shared/permit.mjs';
import { applyDelta, checkSnapshot } from '../shared/backup.mjs';
const sourceValidationModule='../approved-runtime/database.js';
const {validateState}=await import(sourceValidationModule);
import { requireValue } from './store.mjs';
/** @param {string|Buffer} value */
const hash=value=>createHash('sha256').update(value).digest('hex');
const DAY=86400000;
export class Backups {
  /** @param {import('./store.mjs').ServiceStore} store @param {import('./licensing.mjs').Licensing} licensing @param {string} directory @param {{maxSnapshotBytes?:number,maxAccountBytes?:number}} options */
  constructor(store,licensing,directory,{maxSnapshotBytes=8*1024*1024,maxAccountBytes=256*1024*1024}={}){
    this.store=store;this.licensing=licensing;this.directory=path.resolve(directory);this.maxSnapshotBytes=maxSnapshotBytes;this.maxAccountBytes=maxAccountBytes;mkdirSync(this.directory,{recursive:true,mode:0o700});
    store.atomic(()=>store.db.exec(`
      CREATE TABLE IF NOT EXISTS backup_consents(shop_id TEXT PRIMARY KEY REFERENCES shops(id),account_id TEXT NOT NULL REFERENCES accounts(id),backup_license_id TEXT NOT NULL REFERENCES licenses(id),enabled INTEGER NOT NULL,policy_version INTEGER NOT NULL,consented_at INTEGER NOT NULL,notice_at INTEGER);
      CREATE TABLE IF NOT EXISTS backup_streams(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),shop_id TEXT NOT NULL REFERENCES shops(id),app_license_id TEXT NOT NULL REFERENCES licenses(id),installation_id TEXT NOT NULL REFERENCES installations(id),generation INTEGER NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,latest_version_id TEXT);
      CREATE TABLE IF NOT EXISTS backup_events(stream_id TEXT NOT NULL REFERENCES backup_streams(id),sequence INTEGER NOT NULL,event_id TEXT UNIQUE NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(stream_id,sequence));
      CREATE TABLE IF NOT EXISTS backup_versions(id TEXT PRIMARY KEY,stream_id TEXT NOT NULL REFERENCES backup_streams(id),shop_id TEXT NOT NULL REFERENCES shops(id),account_id TEXT NOT NULL REFERENCES accounts(id),sequence INTEGER NOT NULL,checksum TEXT NOT NULL,bytes INTEGER NOT NULL,path TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('ready','deleting','deleted')));
      CREATE INDEX IF NOT EXISTS backup_versions_shop ON backup_versions(shop_id,created_at);
      INSERT OR IGNORE INTO migrations VALUES(2,unixepoch()*1000);
    `));
  }
  /** @param {{account_id:string,role:string}} session @param {string} shopId @param {boolean} download @param {number} now */
  entitlement(session,shopId,download=false,now=Date.now()){
    requireValue(session.role==='customer','Customer content permission required',403);
    const consent=this.store.get('SELECT c.*,l.status,l.starts_at,l.ends_at FROM backup_consents c JOIN licenses l ON l.id=c.backup_license_id JOIN shops s ON s.id=c.shop_id WHERE c.shop_id=? AND c.account_id=? AND s.account_id=?',shopId,session.account_id,session.account_id);
    requireValue(consent&&consent.status==='approved'&&consent.starts_at<=now&&consent.ends_at+(download?30*DAY:0)>now&&(download||consent.enabled),'Backup service is not entitled',403);return consent;
  }
  /** @param {{account_id:string,role:string}} session @param {{shopId:string,backupLicenseId:string,enabled:boolean,policyVersion:number}} input @param {number} now */
  consent(session,{shopId,backupLicenseId,enabled,policyVersion},now=Date.now()){
    requireValue(session.role==='customer'&&policyVersion===1&&typeof enabled==='boolean','Explicit backup consent required',403);
    return this.store.atomic(()=>{
      requireValue(this.store.get('SELECT id FROM accounts WHERE id=? AND role=? AND disabled=0',session.account_id,'customer'),'Account authority unavailable',403);
      const l=this.store.scope(backupLicenseId,session.account_id);requireValue(l&&l.kind==='backup'&&l.shop_id===shopId&&l.status==='approved'&&(l.starts_at===null||l.starts_at<=now)&&(l.ends_at===null||l.ends_at>now),'Backup subscription unavailable',403);
      if(enabled&&l.starts_at===null)this.store.run('UPDATE licenses SET starts_at=?,ends_at=?+duration_ms WHERE id=?',now,now,l.id);
      this.store.run('INSERT INTO backup_consents VALUES(?,?,?,?,1,?,NULL) ON CONFLICT(shop_id) DO UPDATE SET backup_license_id=excluded.backup_license_id,enabled=excluded.enabled,policy_version=1,consented_at=excluded.consented_at,notice_at=NULL',shopId,session.account_id,l.id,Number(enabled),now);
      this.store.audit(session.account_id,'backup.consent',shopId,enabled?'Explicit optional backup consent; 30-day expiry retention disclosed':'User disabled backup uploads','',{policyVersion},now);return {enabled,retentionDays:30};
    });
  }
  /** @param {string} shopId @param {string} accountId */
  latest(shopId,accountId){return this.store.get('SELECT id,stream_id,sequence,checksum,bytes,created_at FROM backup_versions WHERE shop_id=? AND account_id=? AND status=? ORDER BY created_at DESC,rowid DESC LIMIT 1',shopId,accountId,'ready');}
  /** @param {{account_id:string,role:string}} session @param {{appLicenseId:string,installationId:string,generation:number,streamId:string,replaceVersionId?:string|null}} input @param {number} now */
  openStream(session,{appLicenseId,installationId,generation,streamId,replaceVersionId=null},now=Date.now()){
    return this.store.atomic(()=>{
      const license=this.licensing.authorizeUpload(session,appLicenseId,installationId,generation,now);this.entitlement(session,license.shop_id,false,now);
      const existing=this.store.get('SELECT * FROM backup_streams WHERE id=?',streamId);
      if(existing){requireValue(existing.account_id===session.account_id&&existing.installation_id===installationId&&existing.generation===generation,'Unavailable stream',403);return existing;}
      const latest=this.latest(license.shop_id,session.account_id);requireValue((latest?.id||null)===replaceVersionId,'Review latest backup before starting a replacement stream',409);
      requireValue(typeof streamId==='string'&&/^[a-z0-9-]{36}$/i.test(streamId),'Invalid stream ID');
      this.store.run('INSERT INTO backup_streams VALUES(?,?,?,?,?,?,0,NULL)',streamId,session.account_id,license.shop_id,appLicenseId,installationId,generation);
      this.store.audit(session.account_id,'backup.stream',streamId,'Confirmed new backup stream','',{replaceVersionId,generation},now);return this.store.get('SELECT * FROM backup_streams WHERE id=?',streamId);
    });
  }
  /** @param {any} version */
  read(version){
    const file=path.resolve(version.path);requireValue(file.startsWith(this.directory+path.sep),'Invalid private backup path',500);
    const bytes=readFileSync(file);requireValue(bytes.length===version.bytes&&hash(bytes)===version.checksum,'Backup integrity verification failed',409);return checkSnapshot(JSON.parse(bytes.toString('utf8')),validateState);
  }
  /** @param {{account_id:string,role:string}} session @param {{streamId:string,events:any[]}} input @param {number} now */
  receive(session,{streamId,events},now=Date.now()){
    requireValue(Array.isArray(events)&&events.length>0&&events.length<=50,'Invalid backup batch');
    return this.store.atomic(()=>{
      const stream=this.store.get('SELECT * FROM backup_streams WHERE id=? AND account_id=?',streamId,session.account_id);requireValue(stream,'Unavailable stream',403);
      this.licensing.authorizeUpload(session,stream.app_license_id,stream.installation_id,stream.generation,now);this.entitlement(session,stream.shop_id,false,now);
      const previousVersion=stream.latest_version_id?this.store.get('SELECT * FROM backup_versions WHERE id=? AND status=?',stream.latest_version_id,'ready'):null;
      requireValue(!stream.latest_version_id||previousVersion,'Backup base is no longer available; review and enable a new stream',409);
      let snapshot=previousVersion?this.read(previousVersion):null,cursor=stream.cursor;
      for(const event of events){
        requireValue(event&&typeof event.id==='string'&&event.id.length<=100&&Number.isSafeInteger(event.sequence)&&event.sequence>0,'Invalid backup event');const digest=hash(canonical(event));
        const previous=this.store.get('SELECT * FROM backup_events WHERE stream_id=? AND sequence=?',stream.id,event.sequence);
        if(previous){requireValue(previous.event_id===event.id&&previous.digest===digest,'Conflicting retry event',409);continue;}
        requireValue(event.sequence===cursor+1,'Noncontiguous backup sequence',409);
        if(event.kind==='snapshot'){requireValue(cursor===0,'Restore/import must start an explicitly reviewed new stream',409);snapshot=checkSnapshot(event.snapshot,validateState);}
        else{requireValue(event.kind==='delta'&&snapshot,'Missing base snapshot');snapshot=applyDelta(snapshot,event.operations,validateState);}
        this.store.run('INSERT INTO backup_events VALUES(?,?,?,?)',stream.id,event.sequence,event.id,digest);cursor=event.sequence;
      }
      if(cursor===stream.cursor)return {cursor,versionId:stream.latest_version_id,durable:true};
      const bytes=Buffer.from(JSON.stringify(snapshot));requireValue(bytes.length<=this.maxSnapshotBytes,'Backup exceeds snapshot size limit',413);
      const used=this.store.get('SELECT COALESCE(SUM(bytes),0) AS bytes FROM backup_versions WHERE account_id=? AND status<>?',session.account_id,'deleted').bytes;requireValue(used+bytes.length<=this.maxAccountBytes,'Backup storage is full; local data remains on your device',507);
      const id=randomUUID(),file=path.join(this.directory,id+'.json'),fd=openSync(file,'wx',0o600);
      try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
      if(process.platform!=='win32'){const directoryFd=openSync(this.directory,'r');try{fsyncSync(directoryFd);}finally{closeSync(directoryFd);}}
      this.store.run('INSERT INTO backup_versions VALUES(?,?,?,?,?,?,?,?,?,?)',id,stream.id,stream.shop_id,session.account_id,cursor,hash(bytes),bytes.length,file,now,'ready');
      this.store.run('UPDATE backup_streams SET cursor=?,latest_version_id=? WHERE id=?',cursor,id,stream.id);
      this.store.audit(session.account_id,'backup.ack',id,'Durable backup batch committed','',{cursor,bytes:bytes.length},now);return {cursor,versionId:id,durable:true};
    });
  }
  /** @param {{account_id:string,role:string}} session @param {string} shopId @param {number} now */
  versions(session,shopId,now=Date.now()){
    const entitlement=this.entitlement(session,shopId,true,now);return {deleteAfter:entitlement.ends_at+30*DAY,retentionDays:30,warning:now>=entitlement.ends_at,versions:this.store.all('SELECT id,sequence,checksum,bytes,created_at,status FROM backup_versions WHERE shop_id=? AND account_id=? AND status=? ORDER BY created_at DESC,rowid DESC LIMIT 100',shopId,session.account_id,'ready')};
  }
  /** @param {{account_id:string,role:string,installation_id:string}} session @param {string} versionId @param {number} now */
  download(session,versionId,now=Date.now()){
    return this.store.atomic(()=>{
      const version=this.store.get('SELECT * FROM backup_versions WHERE id=? AND account_id=? AND status=?',versionId,session.account_id,'ready');requireValue(version,'Unavailable backup',404);
      const stream=this.store.get('SELECT app_license_id FROM backup_streams WHERE id=?',version.stream_id),license=this.store.scope(stream.app_license_id,session.account_id),installation=this.store.get('SELECT * FROM installations WHERE id=? AND account_id=?',session.installation_id,session.account_id),account=this.store.get('SELECT disabled FROM accounts WHERE id=?',session.account_id);
      requireValue(account&&!account.disabled&&license.status==='approved'&&installation?.status==='approved'&&installation.license_id===license.id&&license.writer_id===installation.id,'Approved current installation required for content',403);
      this.entitlement(session,version.shop_id,true,now);const snapshot=this.read(version);this.store.audit(session.account_id,'backup.download',versionId,'Authorized user backup download','',{},now);return {snapshot,checksum:version.checksum,createdAt:version.created_at};
    });
  }
  /** @param {{dryRun?:boolean,now?:number}} options */
  prune({dryRun=true,now=Date.now()}={}){
    // Scheduled retention only; changing account/license status never deletes files.
    if(!dryRun)this.store.atomic(()=>{const expired=this.store.all('SELECT c.shop_id FROM backup_consents c JOIN licenses l ON l.id=c.backup_license_id WHERE l.ends_at<=? AND c.notice_at IS NULL',now);for(const c of expired){this.store.run('UPDATE backup_consents SET notice_at=? WHERE shop_id=?',now,c.shop_id);this.store.audit('system-retention','backup.retention-notice',c.shop_id,'Account notice queued before expiry retention deletion','',{},now);}});
    const candidates=this.store.all('SELECT v.* FROM backup_versions v JOIN backup_consents c ON c.shop_id=v.shop_id JOIN licenses l ON l.id=c.backup_license_id WHERE v.status<>? AND l.ends_at+?<=? AND c.notice_at<=?','deleted',30*DAY,now,now-DAY);
    if(dryRun)return {dryRun:true,candidates:candidates.map(v=>v.id)};
    /** @type {string[]} */
    const deleted=[];for(const v of candidates){
      this.store.atomic(()=>{
        const current=this.store.get('SELECT l.ends_at FROM backup_consents c JOIN licenses l ON l.id=c.backup_license_id WHERE c.shop_id=?',v.shop_id);if(!current||current.ends_at+30*DAY>now)return;
        this.store.run('UPDATE backup_versions SET status=? WHERE id=?','deleting',v.id);this.store.audit('system-retention','backup.delete-start',v.id,'Expired backup service plus 30 days and prior account notice','',{},now);
        const file=path.resolve(v.path);requireValue(file.startsWith(this.directory+path.sep),'Invalid deletion path',500);try{if(statSync(file).isFile())unlinkSync(file);}catch(error){if(!(error instanceof Error)||!('code'in error)||error.code!=='ENOENT')throw error;}
        this.store.run('UPDATE backup_versions SET status=? WHERE id=?','deleted',v.id);this.store.audit('system-retention','backup.deleted',v.id,'Audited retention deletion completed','',{},now);deleted.push(v.id);
      });
    }return {dryRun:false,deleted};
  }
}
