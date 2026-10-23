import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat, open, copyFile, unlink, rename, access } from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
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
  const config=JSON.parse(await readFile(configFile,'utf8')),key=await privateKey(encryptionKeyFile),directory=await mkdtemp(path.join(tmpdir(),'conta-server-snapshot-')),partial=output+'.partial-'+randomUUID();
  let handle;
  try{
    const source=new DatabaseSync(config.database);try{await backup(source,path.join(directory,'service.sqlite'));}finally{source.close();}
    const copy=new DatabaseSync(path.join(directory,'service.sqlite'));
    /** @type {Record<string,import('node:sqlite').SQLOutputValue>[]} */
    let versions=[];try{if(copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_versions'").get())versions=copy.prepare('SELECT * FROM backup_versions WHERE status=?').all('ready');}finally{copy.close();}
    const files=[{name:'config.json',file:configFile},{name:'service.sqlite',file:path.join(directory,'service.sqlite')},...versions.map(v=>{const file=path.resolve(String(v.path));if(!file.startsWith(path.resolve(config.backupDirectory)+path.sep))throw Error('Backup path outside private storage');return {name:'backups/'+v.id+'.json',file};})];
    let total=0;for(const entry of files){const size=(await stat(entry.file)).size;if(size>MAX_ENTRY)throw Error('Server archive entry exceeds the 64 MiB review limit');total+=size;}if(total>MAX_ARCHIVE)throw Error('Server archive exceeds the 1 GiB review limit');
    handle=await open(partial,'wx',0o600);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);await handle.write(Buffer.concat([MAGIC,iv]));
    await handle.write(cipher.update(JSON.stringify({format:'contaonline-server',schemaVersion:1})+'\n'));
    for(const entry of files){const bytes=await readFile(entry.file);await handle.write(cipher.update(JSON.stringify({name:entry.name,sha256:digest(bytes),data:bytes.toString('base64')})+'\n'));}
    await handle.write(cipher.update('{"end":true}\n'));await handle.write(cipher.final());await handle.write(cipher.getAuthTag());await handle.sync();await handle.close();handle=undefined;
    await copyFile(partial,output,constants.COPYFILE_EXCL);const completed=await open(output,'r+');try{await completed.sync();}finally{await completed.close();}await unlink(partial);return {files:files.length,bytes:total,encrypted:true};
  }catch(error){await handle?.close();try{await unlink(partial);}catch{}throw error;}finally{await removeTemporary(directory);}
}
/** Restore only into a new private directory. Authenticate the archive before installing it.
 * @param {string} input @param {string} target @param {string} encryptionKeyFile */
export async function restoreService(input,target,encryptionKeyFile){
  try{await access(target);throw Error('Recovery target already exists; refusing overwrite');}catch(error){if(!(error instanceof Error)||!('code'in error)||error.code!=='ENOENT')throw error;}
  const key=await privateKey(encryptionKeyFile),size=(await stat(input)).size;if(size>MAX_ARCHIVE*2||size<MAGIC.length+29)throw Error('Invalid server archive size');
  const header=await open(input,'r');const prefix=Buffer.alloc(MAGIC.length+12),tag=Buffer.alloc(16);try{await header.read(prefix,0,prefix.length,0);await header.read(tag,0,16,size-16);}finally{await header.close();}
  if(!prefix.subarray(0,MAGIC.length).equals(MAGIC))throw Error('Unsupported server archive');
  const parent=path.dirname(path.resolve(target));await mkdir(parent,{recursive:true,mode:0o700});const temporary=await mkdtemp(path.join(parent,'.conta-recovery-'));
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,prefix.subarray(MAGIC.length));decipher.setAuthTag(tag);
    const reader=createInterface({input:decipher,crlfDelay:Infinity}),stream=createReadStream(input,{start:prefix.length,end:size-17});
    const transfer=pipeline(stream,decipher);transfer.catch(()=>{});const names=new Set();let first=true,end=false,total=0;
    for await(const line of reader){
      if(line.length>MAX_ENTRY*1.4+4096)throw Error('Oversized archive entry');const item=JSON.parse(line);
      if(first){if(item.format!=='contaonline-server'||item.schemaVersion!==1)throw Error('Unsupported archive payload');first=false;continue;}
      if(item.end===true){end=true;continue;}if(end||!['config.json','service.sqlite'].includes(item.name)&&!/^backups\/[a-f0-9-]{36}\.json$/.test(item.name)||names.has(item.name))throw Error('Invalid archive filename');names.add(item.name);
      const bytes=Buffer.from(item.data,'base64');total+=bytes.length;if(bytes.length>MAX_ENTRY||total>MAX_ARCHIVE||digest(bytes)!==item.sha256)throw Error('Archive checksum/size mismatch');
      const destination=path.resolve(temporary,item.name);if(!destination.startsWith(temporary+path.sep))throw Error('Unsafe recovery entry');await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await writeFile(destination,bytes,{flag:'wx',mode:0o600});
    }
    await transfer;if(!end||!names.has('config.json')||!names.has('service.sqlite'))throw Error('Incomplete server archive');
    const config=JSON.parse(await readFile(path.join(temporary,'config.json'),'utf8')),db=new DatabaseSync(path.join(temporary,'service.sqlite'));
    try{
      if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Recovered database integrity failed');
      const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_versions'").get();if(exists)for(const row of db.prepare('SELECT id FROM backup_versions').all())db.prepare('UPDATE backup_versions SET path=? WHERE id=?').run(path.join(path.resolve(target),'backups',String(row.id)+'.json'),row.id);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }finally{db.close();}
    config.database=path.join(path.resolve(target),'service.sqlite');config.backupDirectory=path.join(path.resolve(target),'backups');await writeFile(path.join(temporary,'config.json'),JSON.stringify(config)+'\n',{mode:0o600});
    await rename(temporary,target);return {files:names.size,bytes:total,integrity:'ok'};
  }catch(error){await removeTemporary(temporary);throw error;}
}
