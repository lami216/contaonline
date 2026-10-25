import { randomUUID } from 'node:crypto';
import { requireValue } from './store.mjs';
import { OPEN_DELETION_STATUSES, privacySettings } from '../shared/privacy.mjs';
const DAY=86400000;
export class PrivacyRequests {
  /** @param {import('./store.mjs').ServiceStore} store */
  constructor(store){this.store=store;}
  settings(){return privacySettings(JSON.parse(this.store.get('SELECT value FROM settings WHERE id=?','public')?.value||'{}'));}
  /** @param {string} accountId */
  status(accountId){
    return {request:this.store.get('SELECT id,status,created_at AS createdAt,updated_at AS updatedAt,response_due_at AS responseDueAt,message_ar AS messageAr,message_fr AS messageFr FROM privacy_deletion_requests WHERE account_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',accountId)||null,shops:this.store.all('SELECT name FROM shops WHERE account_id=? ORDER BY id',accountId),responseDays:this.settings().responseDays};
  }
  /** Credentials and CSRF are verified by the API. This records a request, never a completed erasure.
   * @param {string} accountId @param {number} credentialVersion @param {number} now */
  request(accountId,credentialVersion,now=Date.now()){
    return this.store.atomic(()=>{
      requireValue(this.store.get('SELECT id FROM accounts WHERE id=? AND role=? AND credential_version=?',accountId,'customer',credentialVersion),'Account authority unavailable',403);
      const existing=this.store.get("SELECT id FROM privacy_deletion_requests WHERE account_id=? AND status IN ('requested','in-review','needs-verification')",accountId);
      if(existing)return {...this.status(accountId),created:false};
      const id=randomUUID();
      this.store.run('INSERT INTO privacy_deletion_requests VALUES(?,?,?,?,?,?,?,?)',id,accountId,'requested',now,now,now+this.settings().responseDays*DAY,'','');
      if(this.store.get("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_consents'"))this.store.run('UPDATE backup_consents SET enabled=0 WHERE account_id=?',accountId);
      this.store.audit(accountId,'privacy.deletion-request',id,'Customer requested account and associated data erasure; request requires processing','',{uploadsPaused:true},now);
      return {...this.status(accountId),created:true};
    });
  }
  /** @param {string} accountId @param {string} requestId @param {number} credentialVersion @param {number} now */
  withdraw(accountId,requestId,credentialVersion,now=Date.now()){
    return this.store.atomic(()=>{
      requireValue(this.store.get('SELECT id FROM accounts WHERE id=? AND role=? AND credential_version=?',accountId,'customer',credentialVersion),'Account authority unavailable',403);
      const row=this.store.get('SELECT * FROM privacy_deletion_requests WHERE id=? AND account_id=?',requestId,accountId);requireValue(row,'Unavailable request',404);
      if(row.status==='withdrawn')return this.status(accountId);
      requireValue(OPEN_DELETION_STATUSES.includes(row.status),'Request cannot be withdrawn',409);
      this.store.run('UPDATE privacy_deletion_requests SET status=?,updated_at=? WHERE id=?','withdrawn',now,row.id);
      this.store.audit(accountId,'privacy.deletion-withdrawn',row.id,'Customer withdrew erasure request; optional backups stay disabled','',{},now);
      return this.status(accountId);
    });
  }
  /** @param {string} actor @param {{requestId:string,status:string,messageAr:string,messageFr:string,reason:string}} input @param {number} now */
  review(actor,{requestId,status,messageAr,messageFr,reason},now=Date.now()){
    requireValue(['in-review','needs-verification'].includes(status),'Erasure cannot be marked complete by this workflow');
    return this.store.atomic(()=>{
      const row=this.store.get('SELECT * FROM privacy_deletion_requests WHERE id=?',requestId);requireValue(row&&OPEN_DELETION_STATUSES.includes(row.status),'Unavailable open request',409);
      this.store.run('UPDATE privacy_deletion_requests SET status=?,updated_at=?,message_ar=?,message_fr=? WHERE id=?',status,now,messageAr,messageFr,requestId);
      this.store.audit(actor,'privacy.deletion-review',requestId,reason,'',{status},now);return {ok:true};
    });
  }
  /** @param {number} cursor @param {number} limit */
  list(cursor=0,limit=50){
    const where="r.status IN ('requested','in-review','needs-verification')",total=this.store.get('SELECT COUNT(*) AS count FROM privacy_deletion_requests r WHERE '+where).count;
    const requests=this.store.all('SELECT r.id,r.account_id AS accountId,a.username,r.status,r.created_at AS createdAt,r.updated_at AS updatedAt,r.response_due_at AS responseDueAt,r.message_ar AS messageAr,r.message_fr AS messageFr FROM privacy_deletion_requests r JOIN accounts a ON a.id=r.account_id WHERE '+where+' ORDER BY r.response_due_at,r.id LIMIT ? OFFSET ?',limit,cursor);
    return {requests,total,nextCursor:cursor+requests.length<total?cursor+requests.length:null};
  }
}
