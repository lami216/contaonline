import { ShopDatabase, validateState, StoreError } from './database.js';
import { CAPABILITIES } from './permissions.js';
import { queueCloud, snapshotOf } from './outbox.js';
export class WebShopDatabase extends ShopDatabase {
  constructor() {
    const scope = globalThis.ContaoService.scope;
    if (!scope?.accountId || !scope?.shopId) throw Error('فعّل هذا التثبيت أولًا');
    super('contaonline-shop|' + scope.accountId + '|' + scope.shopId);
    this.scope = scope;
  }
  async open(){
    this.db=await new Promise((resolve,reject)=>{const request=indexedDB.open(this.name,2);request.onupgradeneeded=()=>{for(const name of ['snapshots','users','meta','outbox'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new StoreError('Close older tabs before upgrading local storage'));});
    this.db.onversionchange=()=>this.db.close();return this;
  }
  async save(state,backup=null) {
    await globalThis.ContaoService.requireWrite(this.scope);
    validateState(state);const copy=structuredClone(state);
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['snapshots','users','meta','outbox'],'readwrite'),store=tx.objectStore('snapshots'),old=store.get('shop'),users=tx.objectStore('users').getAll();let failure;
      users.onsuccess=()=>{
        if((old.result?.revision||0)!==this.revision){failure=new StoreError('Data changed in another tab; reload before recording');tx.abort();return;}
        if(backup)store.put({id:'before-compact-product-names',state:structuredClone(backup),updatedAt:new Date().toISOString()});
        store.put({id:'shop',revision:this.revision+1,state:copy,updatedAt:new Date().toISOString()});queueCloud(tx,snapshotOf(copy,users.result));
      };
      tx.oncomplete=()=>{this.revision++;resolve(this.revision);};tx.onerror=tx.onabort=()=>reject(failure||tx.error||new StoreError('Save failed; operation not recorded'));
    });
  }
  async replace(state,users) {
    await globalThis.ContaoService.requireWrite(this.scope);
    validateState(state);
    for(const u of users)if(!u.id||!u.username||!['owner','manager','accountant','sales','custom'].includes(u.role)||!/^([a-f0-9]{64})$/.test(u.password?.hash||'')||!/^([a-f0-9]{32})$/.test(u.password?.salt||'')||u.capabilities&&(!Array.isArray(u.capabilities)||u.capabilities.some(c=>!CAPABILITIES.includes(c))))throw new StoreError('Invalid local user in backup');
    if(new Set(users.map(u=>u.id)).size!==users.length||new Set(users.map(u=>u.username)).size!==users.length||!users.some(u=>u.role==='owner'&&u.active!==false))throw new StoreError('Backup requires distinct users and an active owner');
    // Check the revision and preserve both state and users inside the same transaction.
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['snapshots','users','meta','outbox'],'readwrite'),snapshots=tx.objectStore('snapshots'),userStore=tx.objectStore('users');
      let failure;const old=snapshots.get('shop'),oldUsers=userStore.getAll();
      oldUsers.onsuccess=()=>{
        if((old.result?.revision||0)!==this.revision){failure=new StoreError('Data changed in another tab; reload before restoring');tx.abort();return;}
        snapshots.put({id:'safety-backup',state:old.result?.state,users:oldUsers.result,updatedAt:new Date().toISOString()});
        snapshots.put({id:'shop',state:structuredClone(state),revision:this.revision+1,updatedAt:new Date().toISOString()});
        userStore.clear();for(const user of users)userStore.put(user);
        const sessions=tx.objectStore('meta').openCursor();sessions.onsuccess=()=>{const cursor=sessions.result;if(cursor){if(String(cursor.key).startsWith('session:'))cursor.delete();cursor.continue();}};
        const config=tx.objectStore('meta').get('cloud-config');config.onsuccess=()=>{if(config.result?.value?.enabled)tx.objectStore('meta').put({id:'cloud-config',value:{...config.result.value,enabled:false,requiresReview:true}});};
      };
      tx.oncomplete=()=>{this.revision++;resolve();};
      tx.onerror=tx.onabort=()=>reject(failure||tx.error||new StoreError('Restore failed; previous data preserved'));
    });
  }
  async put(store,value) {
    if (store === 'users' || store === 'snapshots') await globalThis.ContaoService.requireWrite(this.scope);
    if(store==='users')return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['users','snapshots','meta','outbox'],'readwrite'),userStore=tx.objectStore('users'),state=tx.objectStore('snapshots').get('shop'),users=userStore.getAll();
      users.onsuccess=()=>{const rows=users.result,index=rows.findIndex(row=>row.id===value.id);if(index<0)rows.push(value);else rows[index]=value;userStore.put(value);if(state.result?.state)queueCloud(tx,snapshotOf(state.result.state,rows));};
      tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error||new StoreError('User save failed'));
    });
    // Local sessions remain available for authenticated read/export after expiry.
    return super.put(store,value);
  }
}
