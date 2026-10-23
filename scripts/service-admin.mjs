import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServiceStore } from '../server/store.mjs';
import { passwordHash, token, encrypt, digest, base32 } from '../server/security.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.resolve(process.env.SERVICE_PRIVATE_DIR||path.join(root,'private/service'));
if([path.join(root,'dist'),path.join(root,'approved-runtime'),path.join(root,'web')].some(p=>directory===p||directory.startsWith(p+path.sep)))throw Error('Private service data must be outside application assets');
const [command,username]=process.argv.slice(2);
if(!['init','migrate','recover-admin'].includes(command))throw Error('Usage: node scripts/service-admin.mjs init <admin-username> | migrate | recover-admin <admin-username>');
if(command==='init'){
  if(!username||!/^[a-z0-9._-]{3,80}$/.test(username))throw Error('Supply an explicit admin username');
  await mkdir(directory,{recursive:true,mode:0o700});
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),kid=randomUUID();
  const encryptionKey=randomBytes(32),config={schemaVersion:1,database:path.join(directory,'service.sqlite'),backupDirectory:path.join(directory,'backups'),kid,privateJwk:pair.privateKey.export({format:'jwk'}),publicKeys:{[kid]:pair.publicKey.export({format:'jwk'})},encryptionKey:encryptionKey.toString('base64url')};
  await writeFile(path.join(directory,'config.json'),JSON.stringify(config)+'\n',{flag:'wx',mode:0o600});
  const store=new ServiceStore(config.database);
  try{
    if(store.get('SELECT id FROM accounts LIMIT 1'))throw Error('An account already exists; bootstrap refused');
    const secret=token(),totp=randomBytes(20),codes=Array.from({length:10},token),id=randomUUID(),hash=await passwordHash(secret);
    store.atomic(()=>{store.run('INSERT INTO accounts(id,username,password_hash,role,totp_encrypted,created_at) VALUES(?,?,?,?,?,?)',id,username,hash,'owner',encrypt(totp.toString('base64url'),encryptionKey),Date.now());for(const code of codes)store.run('INSERT INTO recovery_codes VALUES(?,?,NULL)',id,digest(code));store.audit(id,'admin.bootstrap',id,'Explicit local administrative bootstrap');});
    await writeFile(path.join(directory,'bootstrap-receipt.json'),JSON.stringify({username,initialPassword:secret,totpBase32:base32(totp),totpUri:`otpauth://totp/contaonline:${encodeURIComponent(username)}?secret=${base32(totp)}&issuer=contaonline`,recoveryCodes:codes,notice:'Transfer privately to the owner, enroll MFA and remove this receipt. Config and recovery codes need encrypted offline backups.'},null,2)+'\n',{flag:'wx',mode:0o600});
    console.log('Bootstrap complete. Read the private bootstrap-receipt.json locally; no credentials are printed.');
  }finally{store.close();}
}else if(command==='recover-admin'){
  if(!username||!process.env.ADMIN_RECOVERY_CODE_FILE)throw Error('Supply username and ADMIN_RECOVERY_CODE_FILE pointing to a private local file; never paste the code in chat');
  const config=JSON.parse(await readFile(process.env.SERVICE_CONFIG_FILE||path.join(directory,'config.json'),'utf8')),code=(await readFile(process.env.ADMIN_RECOVERY_CODE_FILE,'utf8')).trim();
  const store=new ServiceStore(config.database),receipt=path.join(directory,'recovery-'+Date.now()+'.json');
  try{
    const account=store.get('SELECT * FROM accounts WHERE username=? AND role=?',username,'owner');if(!account)throw Error('Unavailable administrator');
    const secret=token(),totp=randomBytes(20),codes=Array.from({length:10},token),hash=await passwordHash(secret);
    store.atomic(()=>{if(store.run('UPDATE recovery_codes SET used_at=? WHERE account_id=? AND code_hash=? AND used_at IS NULL',Date.now(),account.id,digest(code)).changes!==1)throw Error('Invalid or consumed recovery code');store.run('UPDATE accounts SET password_hash=?,totp_encrypted=?,last_totp_step=-1,credential_version=credential_version+1 WHERE id=?',hash,encrypt(totp.toString('base64url'),Buffer.from(config.encryptionKey,'base64url')),account.id);store.run('DELETE FROM sessions WHERE account_id=?',account.id);store.run('DELETE FROM recovery_codes WHERE account_id=?',account.id);for(const replacement of codes)store.run('INSERT INTO recovery_codes VALUES(?,?,NULL)',account.id,digest(replacement));store.audit(account.id,'admin.recovery',account.id,'Explicit local recovery with a one-time recovery code');});
    await writeFile(receipt,JSON.stringify({username,initialPassword:secret,totpBase32:base32(totp),recoveryCodes:codes},null,2)+'\n',{flag:'wx',mode:0o600});console.log('Recovery complete. A private recovery receipt was written; no credentials are printed.');
  }finally{store.close();}
}else{
  const config=JSON.parse(await readFile(process.env.SERVICE_CONFIG_FILE||path.join(directory,'config.json'),'utf8'));
  const store=new ServiceStore(config.database);store.close();console.log('Migrations complete.');
}
