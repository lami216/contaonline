import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
const activeScratch=new Set();
/** Keep this private ledger outside recoverable archives. Restore requires the current copy.
 * Contains hashed tombstones and job receipts, never customer names, financial records or content. */
export class ErasureLedger {
  /** @param {string} filename @param {boolean} create */
  constructor(filename,create=true){
    this.filename=path.resolve(filename);if(!create&&!existsSync(this.filename))throw Error('Current erasure ledger required for recovery');
    mkdirSync(path.dirname(this.filename),{recursive:true,mode:0o700});this.db=new DatabaseSync(this.filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones(subject TEXT PRIMARY KEY,kind TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(receipt_hash TEXT PRIMARY KEY,account_id TEXT,state TEXT NOT NULL,counts TEXT NOT NULL,started_at INTEGER NOT NULL,completed_at INTEGER);
      CREATE TABLE IF NOT EXISTS files(receipt_hash TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(receipt_hash,path));
      CREATE TABLE IF NOT EXISTS archives(path TEXT PRIMARY KEY,key_file TEXT NOT NULL,checksum TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scratch(path TEXT PRIMARY KEY,parent TEXT NOT NULL,pid INTEGER NOT NULL);
    `);
    const columns=this.db.prepare('PRAGMA table_info(jobs)').all().map(row=>row.name);
    if(!columns.includes('stage'))this.db.exec("ALTER TABLE jobs ADD COLUMN stage TEXT NOT NULL DEFAULT 'queued'; ALTER TABLE jobs ADD COLUMN failure TEXT; ALTER TABLE jobs ADD COLUMN last_failure_at INTEGER;");
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('key',randomBytes(32).toString('base64url'));this.db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('id',randomUUID());
    this.key=Buffer.from(String(this.db.prepare('SELECT value FROM settings WHERE id=?').get('key')?.value),'base64url');
    this.id=String(this.db.prepare('SELECT value FROM settings WHERE id=?').get('id')?.value);
  }
  /** @param {string} kind @param {string} id */
  subject(kind,id){return createHmac('sha256',this.key).update(kind+':'+id).digest('hex');}
  /** @param {string} kind @param {string} id */
  has(kind,id){return !!this.db.prepare('SELECT 1 FROM tombstones WHERE subject=?').get(this.subject(kind,id));}
  /** @param {string} receipt */
  hash(receipt){return createHash('sha256').update(receipt).digest('hex');}
  /** @param {string} receipt @param {ReturnType<typeof import('./erasure-data.mjs').erasureScope>} scope @param {number} now */
  begin(receipt,scope,now){
    this.db.exec('BEGIN IMMEDIATE');try{
      const hash=this.hash(receipt);if(!this.db.prepare('SELECT 1 FROM jobs WHERE receipt_hash=?').get(hash)){
        this.db.prepare('INSERT INTO jobs(receipt_hash,account_id,state,counts,started_at) VALUES(?,?,?,?,?)').run(hash,scope.accountId,'pending',JSON.stringify(scope.counts),now);
        for(const [kind,ids]of /** @type {Array<[string,string[]]>} */([['account',[scope.accountId]],['installation',scope.installations.map(i=>String(i.id))]]))for(const id of ids)this.db.prepare('INSERT OR IGNORE INTO tombstones VALUES(?,?)').run(this.subject(kind,id),kind);
        for(const row of scope.versions)this.db.prepare('INSERT OR IGNORE INTO files VALUES(?,?)').run(hash,String(row.path));
      }this.db.exec('COMMIT');return hash;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  /** @param {string} receipt */
  status(receipt){const row=this.db.prepare('SELECT state,counts,started_at,completed_at FROM jobs WHERE receipt_hash=?').get(this.hash(receipt));return row?{state:row.state,counts:JSON.parse(String(row.counts)),startedAt:row.started_at,completedAt:row.completed_at}:null;}
  pending(){return this.db.prepare("SELECT * FROM jobs WHERE state='pending'").all();}
  /** @param {string} hash */
  files(hash){return this.db.prepare('SELECT path FROM files WHERE receipt_hash=?').all(hash).map(r=>String(r.path));}
  /** @param {string} hash @param {number} now */
  complete(hash,now){this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare("UPDATE jobs SET account_id=NULL,state='complete',stage='complete',failure=NULL,completed_at=? WHERE receipt_hash=?").run(now,hash);this.db.prepare('DELETE FROM files WHERE receipt_hash=?').run(hash);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');}
  /** @param {string} hash @param {string} stage */
  step(hash,stage){this.db.prepare("UPDATE jobs SET stage=?,failure=NULL WHERE receipt_hash=? AND state='pending'").run(stage,hash);}
  /** @param {string} hash @param {unknown} error */
  failed(hash,error){const code=error&&typeof error==='object'&&'code'in error&&/^[A-Z_]{2,40}$/.test(String(error.code))?String(error.code):'CHECK_FAILED';this.db.prepare("UPDATE jobs SET failure=?,last_failure_at=? WHERE receipt_hash=? AND state='pending'").run(code,Date.now(),hash);}
  overview(){return this.db.prepare("SELECT receipt_hash,account_id,state,stage,counts,started_at,completed_at,failure,last_failure_at FROM jobs ORDER BY CASE WHEN state='pending' THEN 0 ELSE 1 END,CASE WHEN state='pending' THEN started_at ELSE -started_at END LIMIT 100").all().map(row=>({reference:String(row.receipt_hash).slice(0,12),accountId:row.account_id,state:row.state,stage:row.stage,counts:JSON.parse(String(row.counts)),startedAt:row.started_at,completedAt:row.completed_at,failure:row.failure,lastFailureAt:row.last_failure_at}));}
  summary(){return this.db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END),0) AS pending,COALESCE(SUM(CASE WHEN state='complete' THEN 1 ELSE 0 END),0) AS complete FROM jobs").get();}
  archives(){return this.db.prepare('SELECT * FROM archives').all();}
  /** @param {string} filename @param {string} keyFile @param {string} checksum */
  register(filename,keyFile,checksum){this.db.prepare('INSERT INTO archives VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET checksum=excluded.checksum,key_file=excluded.key_file').run(path.resolve(filename),path.resolve(keyFile),checksum);}
  /** Persist publication intent first: a crash must never leave an unregistered archive.
   * @param {string} filename @param {string} keyFile @param {string} checksum */
  reserveArchive(filename,keyFile,checksum){this.db.prepare('INSERT INTO archives VALUES(?,?,?)').run(path.resolve(filename),path.resolve(keyFile),checksum);}
  /** @param {string} filename @param {string} checksum */
  forgetArchive(filename,checksum){this.db.prepare('DELETE FROM archives WHERE path=? AND checksum=?').run(path.resolve(filename),checksum);}
  /** Register before copying any plaintext. @param {string} directory */
  trackScratch(directory){const resolved=path.resolve(directory);this.db.prepare('INSERT INTO scratch VALUES(?,?,?)').run(resolved,path.dirname(resolved),process.pid);activeScratch.add(resolved);}
  /** @param {string} directory */
  releaseScratch(directory){activeScratch.delete(path.resolve(directory));}
  /** @param {string} directory */
  forgetScratch(directory){this.db.prepare('DELETE FROM scratch WHERE path=?').run(path.resolve(directory));}
  /** Dead-process scratch is part of erasure, including copies left by interrupted recovery. */
  cleanScratch(){
    for(const row of this.db.prepare('SELECT * FROM scratch').all()){
      const resolved=path.resolve(String(row.path)),parent=path.resolve(String(row.parent));
      if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('.conta-recovery-'))throw Error('Unsafe registered recovery scratch');
      if(Number(row.pid)===process.pid&&activeScratch.has(resolved))return false;
      if(Number(row.pid)!==process.pid){try{process.kill(Number(row.pid),0);return false;}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='ESRCH')return false;}}
      rmSync(resolved,{recursive:true,force:true});this.forgetScratch(resolved);
    }return true;
  }
  close(){this.db.close();}
}
