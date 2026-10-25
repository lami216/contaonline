import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat, open, unlink, rename, access, lstat } from 'node:fs/promises';
import { createReadStream, constants, copyFileSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ErasureLedger } from './erasure-ledger.mjs';
import { ServiceStore } from './store.mjs';
import { erasureScope, eraseRows, eraseFiles, compactAfterErasure } from './erasure-data.mjs';
const MAGIC=Buffer.from('CONTA-SERVER-1\n'),MAX_ENTRY=64*1024*1024,MAX_ARCHIVE=1024*1024*1024;
/** @param {Buffer} bytes */
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** @param {string} filename */
async function privateKey(filename){const bytes=await readFile(filename);if(bytes.length!==32)throw Error('Server backup key file must contain exactly 32 random bytes');return bytes;}
/** @param {string} directory */
async function removeTemporary(directory){const resolved=path.resolve(directory);if(!path.basename(resolved).startsWith('.conta-recovery-')&&!resolved.startsWith(path.resolve(tmpdir())+path.sep+'conta-server-snapshot-'))throw Error('Unsafe recovery cleanup');await rm(resolved,{recursive:true,force:true});}
/** Create an authenticated encrypted server archive; never logs config, keys or customer content.
 * @param {string} configFile @param {string} output @param {string} encryptionKeyFile */
export async function snapshotService(configFile,output,encryptionKeyFile){
  const config=JSON.parse(await readFile(configFile,'utf8')),ledger=new ErasureLedger(config.privacyLedgerFile||path.join(path.dirname(config.database),'privacy-ledger.sqlite'));
  try{return await snapshot(configFile,output,encryptionKeyFile,ledger,true);}finally{ledger.close();}
}
/** @param {string} configFile @param {string} output @param {string} encryptionKeyFile @param {ErasureLedger} ledger @param {boolean} register */
async function snapshot(configFile,output,encryptionKeyFile,ledger,register){
  const config=JSON.parse(await readFile(configFile,'utf8')),key=await privateKey(encryptionKeyFile),directory=await mkdtemp(path.join(path.dirname(ledger.filename),'.conta-recovery-snapshot-')),partial=path.join(directory,'archive.partial');ledger.trackScratch(directory);
  let handle;
  try{
    const source=new DatabaseSync(config.database);try{await backup(source,path.join(directory,'service.sqlite'));}finally{source.close();}
    const revision=ledger.db.prepare('SELECT COUNT(*) AS n FROM tombstones').get()?.n;
    const filtered=new ServiceStore(path.join(directory,'service.sqlite'));
    try{for(const a of filtered.all("SELECT id FROM accounts WHERE role='customer'"))if(ledger.has('account',a.id))eraseRows(filtered,erasureScope(filtered,a.id));compactAfterErasure(filtered);}finally{filtered.close();}
    const copy=new DatabaseSync(path.join(directory,'service.sqlite'));
    /** @type {Record<string,import('node:sqlite').SQLOutputValue>[]} */
    let versions=[];try{if(copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_versions'").get())versions=copy.prepare('SELECT * FROM backup_versions WHERE status=?').all('ready');}finally{copy.close();}
    const files=[{name:'config.json',file:configFile},{name:'service.sqlite',file:path.join(directory,'service.sqlite')},...versions.map(v=>{const file=path.resolve(String(v.path));if(!file.startsWith(path.resolve(config.backupDirectory)+path.sep))throw Error('Backup path outside private storage');return {name:'backups/'+v.id+'.json',file};})];
    let total=0;for(const entry of files){const size=(await stat(entry.file)).size;if(size>MAX_ENTRY)throw Error('Server archive entry exceeds the 64 MiB review limit');total+=size;}if(total>MAX_ARCHIVE)throw Error('Server archive exceeds the 1 GiB review limit');
    handle=await open(partial,'wx',0o600);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);await handle.write(Buffer.concat([MAGIC,iv]));
    await handle.write(cipher.update(JSON.stringify({format:'contaonline-server',schemaVersion:2,ledgerId:ledger.id})+'\n'));
    for(const entry of files){const bytes=await readFile(entry.file);await handle.write(cipher.update(JSON.stringify({name:entry.name,sha256:digest(bytes),data:bytes.toString('base64')})+'\n'));}
    await handle.write(cipher.update('{"end":true}\n'));await handle.write(cipher.final());await handle.write(cipher.getAuthTag());await handle.sync();await handle.close();handle=undefined;
    const checksum=digest(await readFile(partial));
    // Reserve durably BEFORE publishing. Missing files keep erasure pending after a process crash.
    ledger.db.exec('BEGIN IMMEDIATE');try{
      if(ledger.db.prepare('SELECT COUNT(*) AS n FROM tombstones').get()?.n!==revision)throw Error('Erasure changed during snapshot; retry with the current data');
      if(register)ledger.reserveArchive(output,encryptionKeyFile,checksum);ledger.db.exec('COMMIT');
    }catch(error){ledger.db.exec('ROLLBACK');throw error;}
    try{copyFileSync(partial,output,constants.COPYFILE_EXCL);const completed=openSync(output,'r+');try{fsyncSync(completed);}finally{closeSync(completed);}}
    catch(error){const existed=error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST';if(!existed)try{unlinkSync(output);}catch(cleanup){if(!cleanup||typeof cleanup!=='object'||!('code'in cleanup)||cleanup.code!=='ENOENT')throw cleanup;}if(register)ledger.forgetArchive(output,checksum);throw error;}
    await unlink(partial);return {files:files.length,bytes:total,encrypted:true};
  }catch(error){await handle?.close();try{await unlink(partial);}catch{}throw error;}finally{ledger.releaseScratch(directory);await removeTemporary(directory);ledger.forgetScratch(directory);}
}
/** Restore only into a new private directory. Authenticate the archive before installing it.
 * @param {string} input @param {string} target @param {string} encryptionKeyFile @param {string} ledgerFile */
export async function restoreService(input,target,encryptionKeyFile,ledgerFile){
  if(!ledgerFile)throw Error('Current erasure ledger required for recovery');const ledger=new ErasureLedger(ledgerFile,false);
  try{return await restore(input,target,encryptionKeyFile,ledger);}finally{ledger.close();}
}
/** @param {string} input @param {string} target @param {string} encryptionKeyFile @param {ErasureLedger} ledger */
async function restore(input,target,encryptionKeyFile,ledger){
  try{await access(target);throw Error('Recovery target already exists; refusing overwrite');}catch(error){if(!(error instanceof Error)||!('code'in error)||error.code!=='ENOENT')throw error;}
  const key=await privateKey(encryptionKeyFile),size=(await stat(input)).size;if(size>MAX_ARCHIVE*2||size<MAGIC.length+29)throw Error('Invalid server archive size');
  const header=await open(input,'r');const prefix=Buffer.alloc(MAGIC.length+12),tag=Buffer.alloc(16);try{await header.read(prefix,0,prefix.length,0);await header.read(tag,0,16,size-16);}finally{await header.close();}
  if(!prefix.subarray(0,MAGIC.length).equals(MAGIC))throw Error('Unsupported server archive');
  const parent=path.dirname(path.resolve(target));await mkdir(parent,{recursive:true,mode:0o700});const temporary=await mkdtemp(path.join(parent,'.conta-recovery-'));ledger.trackScratch(temporary);
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,prefix.subarray(MAGIC.length));decipher.setAuthTag(tag);
    const reader=createInterface({input:decipher,crlfDelay:Infinity}),stream=createReadStream(input,{start:prefix.length,end:size-17});
    const transfer=pipeline(stream,decipher);transfer.catch(()=>{});const names=new Set();let first=true,end=false,total=0;
    for await(const line of reader){
      if(line.length>MAX_ENTRY*1.4+4096)throw Error('Oversized archive entry');const item=JSON.parse(line);
      if(first){if(item.format!=='contaonline-server'||item.schemaVersion!==2||item.ledgerId!==ledger.id)throw Error('Archive requires its current matching erasure ledger; legacy archives require an explicit migration');first=false;continue;}
      if(item.end===true){end=true;continue;}if(end||!['config.json','service.sqlite'].includes(item.name)&&!/^backups\/[a-f0-9-]{36}\.json$/.test(item.name)||names.has(item.name))throw Error('Invalid archive filename');names.add(item.name);
      const bytes=Buffer.from(item.data,'base64');total+=bytes.length;if(bytes.length>MAX_ENTRY||total>MAX_ARCHIVE||digest(bytes)!==item.sha256)throw Error('Archive checksum/size mismatch');
      const destination=path.resolve(temporary,item.name);if(!destination.startsWith(temporary+path.sep))throw Error('Unsafe recovery entry');await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await writeFile(destination,bytes,{flag:'wx',mode:0o600});
    }
    await transfer;if(!end||!names.has('config.json')||!names.has('service.sqlite'))throw Error('Incomplete server archive');
    const revision=ledger.db.prepare('SELECT COUNT(*) AS n FROM tombstones').get()?.n;
    const config=JSON.parse(await readFile(path.join(temporary,'config.json'),'utf8')),store=new ServiceStore(path.join(temporary,'service.sqlite')),db=store.db;
    try{
      if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Recovered database integrity failed');
      const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_versions'").get();if(exists)for(const row of db.prepare('SELECT id FROM backup_versions').all())db.prepare('UPDATE backup_versions SET path=? WHERE id=?').run(path.join(temporary,'backups',String(row.id)+'.json'),row.id);
      await mkdir(path.join(temporary,'backups'),{recursive:true,mode:0o700});
      for(const a of store.all("SELECT id FROM accounts WHERE role='customer'"))if(ledger.has('account',a.id)){const scope=erasureScope(store,a.id);eraseFiles(path.join(temporary,'backups'),a.id,scope.versions.map(v=>String(v.path)));eraseRows(store,scope);}
      if(exists)for(const row of db.prepare('SELECT id FROM backup_versions').all())db.prepare('UPDATE backup_versions SET path=? WHERE id=?').run(path.join(path.resolve(target),'backups',String(row.id)+'.json'),row.id);
      compactAfterErasure(store);
    }finally{db.close();}
    config.database=path.join(path.resolve(target),'service.sqlite');config.backupDirectory=path.join(path.resolve(target),'backups');config.privacyLedgerFile=ledger.filename;await writeFile(path.join(temporary,'config.json'),JSON.stringify(config)+'\n',{mode:0o600});
    ledger.db.exec('BEGIN IMMEDIATE');try{if(ledger.db.prepare('SELECT COUNT(*) AS n FROM tombstones').get()?.n!==revision)throw Error('Erasure changed during recovery; retry');renameSync(temporary,target);ledger.forgetScratch(temporary);ledger.db.exec('COMMIT');}catch(error){ledger.db.exec('ROLLBACK');throw error;}
    return {files:names.size,bytes:total,integrity:'ok'};
  }catch(error){await removeTemporary(temporary);ledger.forgetScratch(temporary);throw error;}finally{ledger.releaseScratch(temporary);}
}
/** Rewrite a managed encrypted archive, retaining other customers and filtering every tombstone.
 * A crash before replacement leaves the old archive registered for retry; after replacement it is already clean.
 * @param {string} input @param {string} keyFile @param {ErasureLedger} ledger */
export async function redactArchive(input,keyFile,ledger){
  const source=await lstat(input);if(!source.isFile()||source.isSymbolicLink()||source.nlink!==1)throw Error('Managed archive must be an owned regular file without extra links');
  const parent=path.dirname(path.resolve(input)),temporary=await mkdtemp(path.join(parent,'.conta-recovery-')),replacement=path.join(temporary,'redacted.enc'),restored=path.join(temporary,'service');
  ledger.trackScratch(temporary);
  try{await restore(input,restored,keyFile,ledger);await snapshot(path.join(restored,'config.json'),replacement,keyFile,ledger,false);await rename(replacement,input);ledger.register(input,keyFile,digest(await readFile(input)));}finally{ledger.releaseScratch(temporary);await removeTemporary(temporary);ledger.forgetScratch(temporary);}
}
