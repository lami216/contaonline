import { ShopDatabase, validateState, StoreError } from './database.js';
import { CAPABILITIES } from './permissions.js';
export class WebShopDatabase extends ShopDatabase {
  constructor() {
    const scope = globalThis.ContaoService.scope;
    if (!scope?.accountId || !scope?.shopId) throw Error('فعّل هذا التثبيت أولًا');
    super('contaonline-shop|' + scope.accountId + '|' + scope.shopId);
    this.scope = scope;
  }
  async save(state,backup=null) {
    await globalThis.ContaoService.requireWrite(this.scope);
    return super.save(state,backup);
  }
  async replace(state,users) {
    await globalThis.ContaoService.requireWrite(this.scope);
    validateState(state);
    for(const u of users)if(!u.id||!u.username||!['owner','manager','accountant','sales','custom'].includes(u.role)||!/^([a-f0-9]{64})$/.test(u.password?.hash||'')||!/^([a-f0-9]{32})$/.test(u.password?.salt||'')||u.capabilities&&(!Array.isArray(u.capabilities)||u.capabilities.some(c=>!CAPABILITIES.includes(c))))throw new StoreError('Invalid local user in backup');
    if(new Set(users.map(u=>u.id)).size!==users.length||new Set(users.map(u=>u.username)).size!==users.length||!users.some(u=>u.role==='owner'&&u.active!==false))throw new StoreError('Backup requires distinct users and an active owner');
    // Check the revision and preserve both state and users inside the same transaction.
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['snapshots','users','meta'],'readwrite'),snapshots=tx.objectStore('snapshots'),userStore=tx.objectStore('users');
      let failure;const old=snapshots.get('shop'),oldUsers=userStore.getAll();
      oldUsers.onsuccess=()=>{
        if((old.result?.revision||0)!==this.revision){failure=new StoreError('Data changed in another tab; reload before restoring');tx.abort();return;}
        snapshots.put({id:'safety-backup',state:old.result?.state,users:oldUsers.result,updatedAt:new Date().toISOString()});
        snapshots.put({id:'shop',state:structuredClone(state),revision:this.revision+1,updatedAt:new Date().toISOString()});
        userStore.clear();for(const user of users)userStore.put(user);
      };
      tx.oncomplete=()=>{this.revision++;resolve();};
      tx.onerror=tx.onabort=()=>reject(failure||tx.error||new StoreError('Restore failed; previous data preserved'));
    });
  }
  async put(store,value) {
    if (store === 'users' || store === 'snapshots') await globalThis.ContaoService.requireWrite(this.scope);
    // Local sessions remain available for authenticated read/export after expiry.
    return super.put(store,value);
  }
}
