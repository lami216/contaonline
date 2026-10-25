import { token, digest } from './security.mjs';
import { requireValue } from './store.mjs';
import { erasureScope, eraseRows, eraseFiles, compactAfterErasure, checkLegacyOrphans } from './erasure-data.mjs';
import { redactArchive } from './recovery.mjs';
/** Durable, idempotent erasure. Completion means files, database and every registered archive succeeded. */
export class AccountErasure {
  /** @param {import('./store.mjs').ServiceStore} store @param {import('./erasure-ledger.mjs').ErasureLedger} ledger @param {string} directory */
  constructor(store,ledger,directory){this.store=store;this.ledger=ledger;this.directory=directory;/** @type {Promise<void>|null} */this.running=null;}
  /** @param {string} accountId @param {number} credentialVersion @param {number} ownerVersion @param {number} now */
  preview(accountId,credentialVersion,ownerVersion,now=Date.now()){
    return this.store.atomic(()=>{
      requireValue(!this.ledger.has('account',accountId),'Account erasure already started',409);
      this.checkVersions(accountId,credentialVersion,ownerVersion);
      const scope=erasureScope(this.store,accountId),receipt=token();
      this.store.run('DELETE FROM privacy_erasure_previews WHERE account_id=? OR expires_at<?',accountId,now);
      this.store.run('INSERT INTO privacy_erasure_previews VALUES(?,?,?,?,?)',digest(receipt),accountId,credentialVersion,ownerVersion,now+300000);
      return {receipt,expiresAt:now+300000,shops:scope.shops,counts:scope.counts,managedArchives:this.ledger.archives().length};
    });
  }
  /** @param {string} accountId @param {number} credentialVersion @param {number} ownerVersion */
  checkVersions(accountId,credentialVersion,ownerVersion){
    requireValue(this.store.get('SELECT id FROM accounts WHERE id=? AND role=? AND credential_version=?',accountId,'customer',credentialVersion),'Service credentials changed; sign in again',401);
    requireValue(this.store.get('SELECT account_id FROM privacy_owner_credentials WHERE account_id=? AND version=?',accountId,ownerVersion),'Owner authority changed; start again',403);
  }
  /** A restored but not yet started service may predate an already completed erasure. */
  reconcileRestored(){
    const pending=new Set(this.ledger.pending().map(job=>String(job.account_id)));
    for(const account of this.store.all("SELECT id FROM accounts WHERE role='customer'"))if(this.ledger.has('account',account.id)&&!pending.has(account.id)){
      const scope=erasureScope(this.store,account.id);checkLegacyOrphans(this.store,this.directory);eraseFiles(this.directory,account.id,scope.versions.map(v=>String(v.path)));eraseRows(this.store,scope);compactAfterErasure(this.store);
    }
  }
  /** @param {string} accountId @param {string} receipt @param {number} credentialVersion @param {number} ownerVersion @param {number} now */
  confirm(accountId,receipt,credentialVersion,ownerVersion,now=Date.now()){
    this.store.atomic(()=>{
      this.checkVersions(accountId,credentialVersion,ownerVersion);
      const preview=this.store.get('SELECT * FROM privacy_erasure_previews WHERE nonce_hash=? AND account_id=?',digest(receipt),accountId);
      requireValue(preview&&preview.expires_at>now&&preview.credential_version===credentialVersion&&preview.owner_version===ownerVersion,'Expired or invalid deletion confirmation',409);
      const scope=erasureScope(this.store,accountId);this.ledger.begin(receipt,scope,now);
      this.store.run('UPDATE accounts SET disabled=1,credential_version=credential_version+1 WHERE id=?',accountId);
      this.store.run('DELETE FROM sessions WHERE account_id=?',accountId);
      if(this.store.get("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_consents'"))this.store.run('UPDATE backup_consents SET enabled=0 WHERE account_id=?',accountId);
    });
    return this.ledger.status(receipt);
  }
  /** Resume after a process failure. Failure leaves a durable pending receipt and denies access. */
  async resume(){
    if(this.running)return this.running;
    this.running=(async()=>{
      for(const job of this.ledger.pending()){
        const hash=String(job.receipt_hash);
        try{
          const accountId=String(job.account_id);this.ledger.step(hash,'recovery-cleanup');
          if(!this.ledger.cleanScratch())continue;
          const account=this.store.get('SELECT id FROM accounts WHERE id=?',accountId);
          if(account){this.store.run('UPDATE accounts SET disabled=1 WHERE id=?',accountId);this.store.run('DELETE FROM sessions WHERE account_id=?',accountId);}
          this.ledger.step(hash,'cloud-files');
          // Deleted account paths remain in the ledger during retry and are already absent on disk.
          if(account)checkLegacyOrphans(this.store,this.directory);
          // Files are recorded durably before rows disappear, so retry still knows every owned path.
          eraseFiles(this.directory,accountId,this.ledger.files(hash));
          this.ledger.step(hash,'records');
          if(account)eraseRows(this.store,erasureScope(this.store,accountId));
          compactAfterErasure(this.store);
          this.ledger.step(hash,'archives');
          for(const archive of this.ledger.archives())await redactArchive(String(archive.path),String(archive.key_file),this.ledger);
          this.ledger.step(hash,'recovery-cleanup');
          if(!this.ledger.cleanScratch())continue;
          this.ledger.complete(hash,Date.now());
        }catch(error){this.ledger.failed(hash,error); /* No customer content or filesystem paths in the failure receipt. */ }
      }
    })();
    try{await this.running;}finally{this.running=null;}
  }
}
