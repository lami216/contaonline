import { fingerprint, base64url, verifyPermit } from './permit.js';
let connection;
export async function serviceDb() {
  if (connection) return connection;
  connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open('contaonline-service-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('service', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  connection.onversionchange = () => { connection.close(); connection = null; };
  return connection;
}
export async function readService(id) {
  const db = await serviceDb();
  return new Promise((resolve,reject) => {
    const request = db.transaction('service').objectStore('service').get(id);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}
export async function writeService(id, value) {
  const db = await serviceDb();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('service','readwrite');
    const store=tx.objectStore('service'),accountId=id.startsWith('permit:')?id.slice(7):id.startsWith('identity:')?id.slice(9):null;
    if(accountId){const barrier=store.get('erased:'+accountId);barrier.onsuccess=()=>{if(barrier.result){if(id.startsWith('identity:')){tx.abort();return;}value={...value,restriction:'account-deleted'};}store.put({id,value});};}else store.put({id,value});
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error || Error('تعذّر حفظ بيانات التفعيل'));
  });
}
export async function identityFor(accountId) {
  if(await readService('erased:'+accountId))throw Error('هذا الحساب محذوف / Ce compte est supprimé');
  const slot = 'identity:' + accountId;
  const existing = await readService(slot);
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, false, ['sign','verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const candidate = { accountId, id:crypto.randomUUID(), publicJwk, privateKey:pair.privateKey };
  const db = await serviceDb();
  // Generate before opening the transaction; a concurrent tab must keep the first durable key.
  return new Promise((resolve,reject) => {
    const tx = db.transaction('service','readwrite'), store = tx.objectStore('service');
    let winner;
    const barrier=store.get('erased:'+accountId);barrier.onsuccess=()=>{if(barrier.result){tx.abort();return;}const get = store.get(slot);get.onsuccess = () => { winner = get.result?.value || candidate; if (!get.result) store.put({id:slot,value:candidate}); };};
    tx.oncomplete = () => resolve(winner);
    tx.onerror = tx.onabort = () => reject(tx.error || Error('تعذّر حفظ مفتاح التثبيت'));
  });
}
export async function installPermit(envelope, keys, identity,serverTime=Date.now()) {
  await verifyPermit(envelope, keys, identity,serverTime);
  const clientNow=Date.now();
  const record = { envelope, keys, accountId:identity.accountId,clockOffsetMs:serverTime-clientNow,lastClientWallMs:clientNow,maxWallMs:Math.max(serverTime,envelope.payload.issuedAt), restriction:null };
  await writeService('permit:' + identity.accountId, record);
  await writeService('current-account', identity.accountId);
  return record;
}
export async function currentActivation() {
  const accountId = await readService('current-account');
  if (!accountId) return null;
  const identity = await readService('identity:' + accountId), record = await readService('permit:' + accountId);
  if (!identity || !record) return null;
  if(await readService('erased:'+accountId))record.restriction='account-deleted';
  const result = await verifyPermit(record.envelope, record.keys, identity, Math.max(Date.now()+(record.clockOffsetMs||0),record.maxWallMs||0));
  return { identity, record, ...result };
}
export async function proof(identity, message) {
  return base64url(await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, identity.privateKey, new TextEncoder().encode(message)));
}
export { fingerprint };
export async function markServiceErased(accountId){
  await writeService('erased:'+accountId,true);
  dispatchEvent(new CustomEvent('conta-account-erased',{detail:{accountId}}));
}
export async function eraseLocalAccount(accountId,shopIds){
  await markServiceErased(accountId);
  const prefix='contaonline-shop|'+accountId+'|',names=new Set(shopIds.map(shopId=>prefix+shopId));
  if(typeof indexedDB.databases==='function')for(const database of await indexedDB.databases())if(database.name?.startsWith(prefix))names.add(database.name);
  for(const name of names)await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('أغلق نوافذ المحل الأخرى ثم أعد حذف بيانات هذا الجهاز / Fermez les autres fenêtres du magasin puis réessayez'));});
  const db=await serviceDb();await new Promise((resolve,reject)=>{const tx=db.transaction('service','readwrite'),store=tx.objectStore('service');store.delete('identity:'+accountId);store.delete('permit:'+accountId);const current=store.get('current-account');current.onsuccess=()=>{if(current.result?.value===accountId)store.delete('current-account');};tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});
}
