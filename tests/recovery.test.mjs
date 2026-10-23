import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ServiceStore } from '../server/store.mjs';
import { snapshotService, restoreService } from '../server/recovery.mjs';
test('encrypted server archive restores database, audit, private files and key configuration into a new directory; tamper and overwrite fail',async()=>{
  const temporaryBase=path.resolve(process.env.TEST_TMPDIR||tmpdir());
  const root=await mkdtemp(path.join(temporaryBase,'contaonline-recovery-test-')),source=path.join(root,'source'),target=path.join(root,'restored'),keyFile=path.join(root,'archive.key'),archive=path.join(root,'snapshot.conta.enc');
  try{
    await mkdir(path.join(source,'backups'),{recursive:true});await writeFile(keyFile,randomBytes(32));
    const filename=path.join(source,'service.sqlite'),db=new ServiceStore(filename),id=randomUUID(),privateFile=path.join(source,'backups',id+'.json'),content=JSON.stringify({fixture:true});
    await writeFile(privateFile,content);
    db.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)','fixture','fixture','fixture-only','customer',1234);
    db.audit('fixture','fixture.recovery','fixture','Synthetic recovery test');
    db.db.exec('CREATE TABLE backup_versions(id TEXT PRIMARY KEY,path TEXT NOT NULL,status TEXT NOT NULL)');db.run('INSERT INTO backup_versions VALUES(?,?,?)',id,privateFile,'ready');
    const config={database:filename,backupDirectory:path.join(source,'backups'),kid:randomUUID(),encryptionKey:randomBytes(32).toString('base64url'),fixtureKey:randomBytes(32).toString('base64url')},configFile=path.join(source,'config.json');await writeFile(configFile,JSON.stringify(config));
    db.close();const result=await snapshotService(configFile,archive,keyFile);assert.equal(result.encrypted,true);assert.equal(result.files,3);
    const encrypted=await readFile(archive);assert.equal(encrypted.includes(Buffer.from(config.fixtureKey)),false);assert.equal(encrypted.includes(Buffer.from('fixture.recovery')),false);
    const restored=await restoreService(archive,target,keyFile);assert.equal(restored.integrity,'ok');const restoredConfig=JSON.parse(await readFile(path.join(target,'config.json'),'utf8'));assert.equal(restoredConfig.fixtureKey,config.fixtureKey);assert.equal(restoredConfig.database,path.join(target,'service.sqlite'));assert.equal(await readFile(path.join(target,'backups',id+'.json'),'utf8'),content);
    const copy=new ServiceStore(restoredConfig.database);try{assert.equal(copy.get('SELECT username FROM accounts').username,'fixture');assert.equal(copy.all('SELECT * FROM audit').length,1);assert.equal(copy.get('SELECT path FROM backup_versions').path,path.join(target,'backups',id+'.json'));}finally{copy.close();}
    await assert.rejects(restoreService(archive,target,keyFile),/already exists/);encrypted[encrypted.length-1]^=1;await writeFile(path.join(root,'tampered.conta.enc'),encrypted);const rejectedTarget=path.join(root,'must-not-install');await assert.rejects(restoreService(path.join(root,'tampered.conta.enc'),rejectedTarget,keyFile));await assert.rejects(access(rejectedTarget));
  }finally{assert.ok(root.startsWith(temporaryBase+path.sep));await rm(root,{recursive:true,force:true});}
});
