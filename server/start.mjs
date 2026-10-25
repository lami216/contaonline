import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp, stagingDigest } from './app.mjs';
import { ServiceStore } from './store.mjs';
import { Licensing } from './licensing.mjs';
import { registerServiceApi } from './api.mjs';
import path from 'node:path';
import { Backups } from './backups.mjs';
import { ErasureLedger } from './erasure-ledger.mjs';
import { AccountErasure } from './erasure.mjs';
if(process.env.NODE_ENV==='production')throw Error('This phase is not approved for production deployment');
if(!process.env.STAGING_ACCESS_KEY_FILE)throw Error('Set STAGING_ACCESS_KEY_FILE to a private key file');
const credentials=JSON.parse(await readFile(process.env.STAGING_ACCESS_KEY_FILE,'utf8'));
const distDirectory=fileURLToPath(new URL('../dist',import.meta.url));
const repositoryDirectory=fileURLToPath(new URL('../',import.meta.url));
let store=null,licensing=null,config=null;
if(process.env.SERVICE_CONFIG_FILE){
  config=JSON.parse(await readFile(process.env.SERVICE_CONFIG_FILE,'utf8'));
  for(const file of [config.database,config.backupDirectory,config.privacyLedgerFile||path.join(path.dirname(config.database),'privacy-ledger.sqlite'),process.env.SERVICE_CONFIG_FILE]){
    const resolved=path.resolve(file).toLowerCase(),root=path.resolve(repositoryDirectory).toLowerCase();
    if(!path.isAbsolute(file)||resolved.startsWith(root+path.sep)&&![path.join(root,'private')+path.sep,path.join(root,'data')+path.sep].some(prefix=>resolved.startsWith(prefix)))throw Error('Service storage must be absolute and outside application/source assets');
  }
  store=new ServiceStore(config.database);licensing=new Licensing(store,config);
}
const serviceStore=store,serviceLicensing=licensing,serviceConfig=config;
const backups=serviceStore&&serviceLicensing?new Backups(serviceStore,serviceLicensing,serviceConfig.backupDirectory):undefined;
const ledger=serviceStore?new ErasureLedger(serviceConfig.privacyLedgerFile||path.join(path.dirname(serviceConfig.database),'privacy-ledger.sqlite')):undefined;
const erasure=serviceStore&&ledger?new AccountErasure(serviceStore,ledger,serviceConfig.backupDirectory):undefined;
await erasure?.resume();
erasure?.reconcileRestored();
const app=await createApp({distDirectory,stagingHash:stagingDigest(credentials.username,credentials.secret),...(serviceStore&&serviceLicensing?{
  publicConfig:()=>JSON.parse(serviceStore.get('SELECT value FROM settings WHERE id=?','public')?.value||'{"apk":{"enabled":false}}'),
  registerApi:app=>registerServiceApi(app,{store:serviceStore,licensing:serviceLicensing,backups,erasure,encryptionKey:Buffer.from(serviceConfig.encryptionKey,'base64url'),secureCookies:false})
}:{})});
const erasureRetry=setInterval(()=>{erasure?.resume().catch(()=>console.warn('Erasure retry unavailable; durable pending receipts retained'));},30000);erasureRetry.unref();
if(serviceStore)app.addHook('onClose',async()=>{clearInterval(erasureRetry);if(erasure?.running)await erasure.running;serviceStore.close();ledger?.close();});
await app.listen({host:'127.0.0.1',port:Number(process.env.PORT||4318)});
console.log('Private local review is listening on loopback');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
