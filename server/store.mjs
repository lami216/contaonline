import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
export class ServiceError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status,message){super(message);this.statusCode=status;}
}
/** @param {unknown} condition @param {string} message @param {number} status */
export function requireValue(condition,message='Invalid request',status=400){if(!condition)throw new ServiceError(status,message);}
export class ServiceStore {
  /** @param {string} filename */
  constructor(filename){
    this.db=new DatabaseSync(filename);this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    if(this.get("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'")&&Number(this.get('SELECT MAX(version) AS version FROM migrations').version)>4){this.db.close();throw Error('Unsupported future service schema; database was not replaced');}
    this.atomic(()=>this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery_codes(account_id TEXT NOT NULL REFERENCES accounts(id),code_hash TEXT NOT NULL,used_at INTEGER,PRIMARY KEY(account_id,code_hash));
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','owner','support')),disabled INTEGER NOT NULL DEFAULT 0,credential_version INTEGER NOT NULL DEFAULT 1,totp_encrypted TEXT,last_totp_step INTEGER NOT NULL DEFAULT -1,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shops(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),name TEXT NOT NULL,customer_name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('app','backup')),duration_ms INTEGER NOT NULL CHECK(duration_ms>0),price_minor INTEGER NOT NULL CHECK(price_minor>=0),currency TEXT NOT NULL,offline_ms INTEGER CHECK(offline_ms>0),enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS licenses(id TEXT PRIMARY KEY,shop_id TEXT NOT NULL REFERENCES shops(id),plan_id TEXT NOT NULL REFERENCES plans(id),kind TEXT NOT NULL CHECK(kind IN ('app','backup')),status TEXT NOT NULL CHECK(status IN ('approved','suspended','blocked')),duration_ms INTEGER NOT NULL CHECK(duration_ms>0),offline_ms INTEGER,starts_at INTEGER,ends_at INTEGER,writer_id TEXT,generation INTEGER NOT NULL DEFAULT 0,CHECK((starts_at IS NULL AND ends_at IS NULL) OR ends_at>starts_at));
      CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,license_id TEXT NOT NULL REFERENCES licenses(id),amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),currency TEXT NOT NULL,paid_at INTEGER NOT NULL,reference TEXT NOT NULL,note TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES accounts(id),created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL,payment_reference TEXT NOT NULL,at INTEGER NOT NULL,metadata TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append only');END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append only');END;
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),csrf_hash TEXT NOT NULL,credential_version INTEGER NOT NULL,expires_at INTEGER NOT NULL,mfa INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),session_hash TEXT NOT NULL,purpose TEXT NOT NULL,license_id TEXT NOT NULL REFERENCES licenses(id),installation_id TEXT NOT NULL,public_jwk TEXT NOT NULL,message TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER);
      CREATE TABLE IF NOT EXISTS installations(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),license_id TEXT NOT NULL REFERENCES licenses(id),fingerprint TEXT NOT NULL,public_jwk TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('approved','pending-conflict','rejected','suspended','revoked')),first_at INTEGER NOT NULL,last_seen_at INTEGER,last_activation_at INTEGER,UNIQUE(license_id,fingerprint));
      CREATE TABLE IF NOT EXISTS presence(installation_id TEXT PRIMARY KEY REFERENCES installations(id),last_at INTEGER NOT NULL,lease_until INTEGER NOT NULL,overlap_since INTEGER,overlap_last INTEGER);
      CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,license_id TEXT NOT NULL REFERENCES licenses(id),kind TEXT NOT NULL,opened_at INTEGER NOT NULL,resolved_at INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS incident_open ON incidents(license_id,kind) WHERE resolved_at IS NULL;
      CREATE INDEX IF NOT EXISTS installations_license ON installations(license_id);
      CREATE INDEX IF NOT EXISTS licenses_shop ON licenses(shop_id);
      CREATE INDEX IF NOT EXISTS shops_account ON shops(account_id,id);
      CREATE INDEX IF NOT EXISTS installations_account ON installations(account_id,first_at);
      CREATE INDEX IF NOT EXISTS audit_account_action_time ON audit(actor_id,action,at);
      CREATE INDEX IF NOT EXISTS audit_target ON audit(target_id,id);
      INSERT OR IGNORE INTO migrations VALUES(1,unixepoch()*1000);
      CREATE TABLE IF NOT EXISTS privacy_deletion_requests(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),status TEXT NOT NULL CHECK(status IN ('requested','in-review','needs-verification','withdrawn')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,response_due_at INTEGER NOT NULL,message_ar TEXT NOT NULL,message_fr TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_privacy_request ON privacy_deletion_requests(account_id) WHERE status IN ('requested','in-review','needs-verification');
      INSERT OR IGNORE INTO migrations VALUES(3,unixepoch()*1000);
      CREATE TABLE IF NOT EXISTS privacy_owner_credentials(account_id TEXT PRIMARY KEY REFERENCES accounts(id),code_hash TEXT NOT NULL,version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS privacy_erasure_previews(nonce_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),credential_version INTEGER NOT NULL,owner_version INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(4,unixepoch()*1000);
      DELETE FROM limits WHERE key LIKE 'login:%' AND length(key)=70;
    `));
  }
  /** Dynamic SQL row boundary; route schemas and relational constraints validate writes.
   * @param {string} sql @param {...import('node:sqlite').SQLInputValue} args @returns {any} */
  get(sql,...args){return this.db.prepare(sql).get(...args);}
  /** @param {string} sql @param {...import('node:sqlite').SQLInputValue} args @returns {any[]} */
  all(sql,...args){return this.db.prepare(sql).all(...args);}
  /** @param {string} sql @param {...import('node:sqlite').SQLInputValue} args */
  run(sql,...args){return this.db.prepare(sql).run(...args);}
  /** @template T @param {()=>T} fn @returns {T} */
  atomic(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();if(result instanceof Promise)throw Error('No asynchronous work inside a SQLite transaction');this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  close(){this.db.close();}
  /** @param {string} actor @param {string} action @param {string} target @param {string} reason @param {string} reference @param {object} metadata @param {number} now */
  audit(actor,action,target,reason,reference='',metadata={},now=Date.now()){
    requireValue(typeof reason==='string'&&reason.trim().length>=3&&reason.length<=1000,'A reason is required');
    this.run('INSERT INTO audit(actor_id,action,target_id,reason,payment_reference,at,metadata) VALUES(?,?,?,?,?,?,?)',actor,action,target,reason,reference,now,JSON.stringify(metadata));
  }
  /** @param {string} key @param {number} max @param {number} windowMs @param {number} now */
  limit(key,max,windowMs,now=Date.now()){
    const row=this.get('SELECT * FROM limits WHERE key=?',key);
    if(row&&row.until_at>now){requireValue(row.count<max,'Too many requests',429);this.run('UPDATE limits SET count=count+1 WHERE key=?',key);}
    else this.run('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=1,until_at=excluded.until_at',key,now+windowMs);
    this.run('DELETE FROM limits WHERE until_at<?',now-86400000);
  }
  /** @param {string} licenseId @param {string} accountId */
  scope(licenseId,accountId){return this.get('SELECT l.*,s.account_id,s.name AS store_name,s.customer_name FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE l.id=? AND s.account_id=?',licenseId,accountId);}
  /** @param {string} actor @param {{shopId:string,planId:string,reason:string,paymentReference:string,explicitStart?:number|null}} input @param {number} now */
  issueLicense(actor,{shopId,planId,reason,paymentReference,explicitStart=null},now=Date.now()){
    return this.atomic(()=>{
      const plan=this.get('SELECT * FROM plans WHERE id=? AND enabled=1',planId);requireValue(plan,'Unknown plan');
      requireValue(this.get('SELECT id FROM shops WHERE id=?',shopId),'Unknown shop');
      requireValue(typeof paymentReference==='string'&&paymentReference.trim().length>0,'Manual payment reference required');
      requireValue(explicitStart===null||Number.isSafeInteger(explicitStart)&&explicitStart>=0,'Invalid start date');
      requireValue(explicitStart===null||Number.isSafeInteger(explicitStart+plan.duration_ms),'Subscription date exceeds supported range');
      const id=randomUUID();this.run('INSERT INTO licenses(id,shop_id,plan_id,kind,status,duration_ms,offline_ms,starts_at,ends_at) VALUES(?,?,?,?,?,?,?,?,?)',id,shopId,planId,plan.kind,'approved',plan.duration_ms,plan.offline_ms,explicitStart,explicitStart===null?null:explicitStart+plan.duration_ms);
      this.audit(actor,'license.issue',id,reason,paymentReference,{planId,explicitStart},now);return this.get('SELECT * FROM licenses WHERE id=?',id);
    });
  }
  /** @param {string} actor @param {{licenseId:string,durationMs:number,reason:string,paymentReference:string}} input @param {number} now */
  renew(actor,{licenseId,durationMs,reason,paymentReference},now=Date.now()){
    requireValue(Number.isSafeInteger(durationMs)&&durationMs>0&&durationMs<=10*366*86400000,'Invalid renewal duration');
    requireValue(typeof paymentReference==='string'&&paymentReference.trim().length>0,'Manual payment reference required');
    return this.atomic(()=>{
      const license=this.get('SELECT * FROM licenses WHERE id=?',licenseId);requireValue(license,'Unknown license');
      requireValue(Number.isSafeInteger((license.starts_at===null?license.duration_ms:Math.max(license.ends_at,now))+durationMs),'Renewal exceeds supported range');
      if(license.starts_at===null)this.run('UPDATE licenses SET duration_ms=duration_ms+? WHERE id=?',durationMs,licenseId);
      else this.run('UPDATE licenses SET ends_at=? WHERE id=?',Math.max(license.ends_at,now)+durationMs,licenseId);
      this.audit(actor,'license.renew',licenseId,reason,paymentReference,{durationMs,previousEnd:license.ends_at},now);return this.get('SELECT * FROM licenses WHERE id=?',licenseId);
    });
  }
}
