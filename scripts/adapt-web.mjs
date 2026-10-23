/** Explicit, fail-closed web adaptations; the imported source remains immutable. */
/** @param {string} source @param {string} search @param {string} replacement */
function once(source,search,replacement){
  if(source.split(search).length!==2)throw Error('Web adaptation anchor changed: '+search.slice(0,90));
  return source.replace(search,replacement);
}
/** @param {string} source @param {string} prefix @param {string} replacement */
function line(source,prefix,replacement){
  const lines=source.split(/\r?\n/),indices=lines.flatMap((value,i)=>value.startsWith(prefix)?[i]:[]);
  if(indices.length!==1)throw Error('Web adaptation line changed: '+prefix);
  lines[indices[0]]=replacement;return lines.join('\n');
}
/** @param {string} source */
export function adaptApp(source){
  // The upstream draft key was shared by all shops on an origin.
  source=source.replaceAll("'alkarna-pos-draft:'", "('contaonline-pos-draft:'+encodeURIComponent(globalThis.ContaoService.scope.accountId)+':'+encodeURIComponent(globalThis.ContaoService.scope.shopId)+':')");
  source=once(source,"import {ShopDatabase,validateState,passwordDigest,verifyPassword} from './database.js';","import {WebShopDatabase as ShopDatabase} from './web-database.js';\nimport {validateState,passwordDigest,verifyPassword} from './database.js';\nimport {offerFile} from './web-export.js';");
  source=line(source,'async function offerExport(', "async function offerExport(name,blob){modal=null;render();return offerFile(name,blob)}");
  source=line(source,'function download(', "function download(name,text,type='application/json'){return offerFile(name,new Blob([text],{type}))}");
  source=line(source,'async function exportBackup(', "async function exportBackup(){const payload={format:'alkarna-web-backup',schemaVersion:1,createdAt:new Date().toISOString(),state:stateForSave(),users:await database.all('users')};await offerFile('alkarna-'+today()+'.json',new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));if(globalThis.ContaoService.canWrite())S.lastBackupPreparedAt=new Date().toISOString();}");
  const identity=/async function readSetupIdentity\(\)\{[\s\S]*?\n\}/;
  if(!identity.test(source))throw Error('Setup identity anchor changed');
  source=source.replace(identity,"async function readSetupIdentity(){return globalThis.ContaoService.setupIdentity()}");
  source=once(source,"if(window.NativeHost&&!NativeHost.licenseAllowed()){NativeHost.openActivation();return}","if(!await globalThis.ContaoService.allowAction(action,permissionFor))return;");
  source=once(source,"if(action==='site:activation'){savePosDraft();NativeHost.openActivation();return}","if(action==='site:activation'){location.assign('/app/');return}");
  source=once(source,"if(changed||namesChanged)","if((changed||namesChanged)&&globalThis.ContaoService.canWrite())");
  source=once(source,"ready=true;view='home';activeTab='home';restorePosDraft();render();","ready=true;globalThis.ContaoRuntime.storageState='ready';view='home';activeTab='home';restorePosDraft();render();");
  source=once(source,"catch(e){ready=true;actor=null;document.querySelector('#phone').innerHTML=","catch(e){globalThis.ContaoRuntime.storageState='failed';globalThis.ContaoPwa.refresh?.();ready=true;actor=null;document.querySelector('#phone').innerHTML=");
  source=once(source,"if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{})","globalThis.ContaoPwa.prepare().then(()=>globalThis.ContaoPwa.refresh()).catch(()=>{})");
  source=once(source,"await boot();","\n globalThis.ContaoRuntime={storageState:'opening',isAuthenticated:()=>!!actor,backupAllowed:()=>!!actor&&can('settings.backup.manage'),isBusy:()=>busy||!ready,saveBeforeUpdate:()=>{if(busy||!ready||globalThis.ContaoBackup?.isBusy?.())return false;try{if(actor&&cart.length){const key='contaonline-pos-draft:'+encodeURIComponent(globalThis.ContaoService.scope.accountId)+':'+encodeURIComponent(globalThis.ContaoService.scope.shopId)+':'+actor.id,value=JSON.stringify(posDraftSnapshot());localStorage.setItem(key,value);if(localStorage.getItem(key)!==value)return false;}else savePosDraft();return true}catch{return false}}};\nawait boot();");
  if(source.includes("fetch('/api/export'"))throw Error('Remote export must not remain in the web build');
  return source;
}
/** @param {string} source */
export function adaptIndex(source){
  source=source.replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');
  source=once(source,'</head>','<link rel="stylesheet" href="web.css"><link rel="apple-touch-icon" href="assets/icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes"><script defer src="assets/sql-asm.js"></script><script defer src="assets/jspdf.umd.min.js"></script></head>');
  return once(source,'</body>','<script type="module" src="bootstrap.js"></script></body>');
}
