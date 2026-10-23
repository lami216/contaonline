import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ServiceStore } from '../server/store.mjs';
import { passwordMatches } from '../server/security.mjs';
test('administrative CLI bootstrap and one-time recovery keep generated credentials off stdout and preserve audit',async()=>{
  const base=path.resolve(process.env.TEST_TMPDIR||tmpdir()),directory=await mkdtemp(path.join(base,'conta-admin-cli-')),script=fileURLToPath(new URL('../scripts/service-admin.mjs',import.meta.url));
  const env={...process.env,SERVICE_PRIVATE_DIR:directory,SERVICE_CONFIG_FILE:path.join(directory,'config.json'),ADMIN_RECOVERY_CODE_FILE:path.join(directory,'input-recovery-code.txt')};
  try{
    const first=spawnSync(process.execPath,[script,'init','fixture-owner'],{env,encoding:'utf8'});assert.equal(first.status,0,first.stderr);const receipt=JSON.parse(await readFile(path.join(directory,'bootstrap-receipt.json'),'utf8'));assert.equal(first.stdout.includes(receipt.initialPassword),false);assert.equal(first.stdout.includes(receipt.totpBase32),false);
    const config=JSON.parse(await readFile(path.join(directory,'config.json'),'utf8'));let store=new ServiceStore(config.database);try{assert.ok(await passwordMatches(receipt.initialPassword,store.get('SELECT password_hash FROM accounts').password_hash));}finally{store.close();}
    const duplicate=spawnSync(process.execPath,[script,'init','fixture-owner'],{env,encoding:'utf8'});assert.notEqual(duplicate.status,0);
    await writeFile(env.ADMIN_RECOVERY_CODE_FILE,receipt.recoveryCodes[0]);const recovered=spawnSync(process.execPath,[script,'recover-admin','fixture-owner'],{env,encoding:'utf8'});assert.equal(recovered.status,0,recovered.stderr);
    const filename=(await readdir(directory)).find(name=>name.startsWith('recovery-'));assert.ok(filename);const recovery=JSON.parse(await readFile(path.join(directory,filename),'utf8'));assert.equal(recovered.stdout.includes(recovery.initialPassword),false);
    store=new ServiceStore(config.database);try{const a=store.get('SELECT * FROM accounts');assert.equal(await passwordMatches(receipt.initialPassword,a.password_hash),false);assert.ok(await passwordMatches(recovery.initialPassword,a.password_hash));assert.equal(a.credential_version,2);assert.equal(store.all('SELECT * FROM audit').length,2);}finally{store.close();}
    const replay=spawnSync(process.execPath,[script,'recover-admin','fixture-owner'],{env,encoding:'utf8'});assert.notEqual(replay.status,0);assert.match(replay.stderr,/Invalid or consumed/);
  }finally{assert.ok(directory.startsWith(base+path.sep));await rm(directory,{recursive:true,force:true});}
});
