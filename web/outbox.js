import { diffSnapshot } from './backup-contract.js';
export const snapshotOf=(state,users)=>({format:'contaonline-backup',schemaVersion:1,state:structuredClone(state),users:structuredClone(users)});
// Called only while the caller's local business transaction is active.
export function queueCloud(tx,snapshot){
  const meta=tx.objectStore('meta'),configRequest=meta.get('cloud-config');
  configRequest.onsuccess=()=>{
    const config=configRequest.result?.value;if(!config?.enabled||config.requiresReview)return;
    const streamRequest=meta.get('cloud-sequence'),previousRequest=meta.get('cloud-last');
    previousRequest.onsuccess=()=>{
      const sequence=(streamRequest.result?.value||0)+1,previous=previousRequest.result?.value;
      const event=sequence===1?{id:crypto.randomUUID(),sequence,kind:'snapshot',snapshot}:{id:crypto.randomUUID(),sequence,kind:'delta',operations:diffSnapshot(previous,snapshot)};
      if(event.kind==='delta'&&!event.operations.length)return;
      tx.objectStore('outbox').put({id:event.id,streamId:config.streamId,event});
      meta.put({id:'cloud-sequence',value:sequence});meta.put({id:'cloud-last',value:snapshot});
    };
  };
}
export async function cloudStatus(db){return {config:(await db.get('meta','cloud-config'))?.value||null,ack:(await db.get('meta','cloud-ack'))?.value||null,pending:(await allOutbox(db)).length};}
export function allOutbox(db){return new Promise((resolve,reject)=>{const request=db.db.transaction('outbox').objectStore('outbox').getAll();request.onsuccess=()=>resolve(request.result.sort((a,b)=>a.event.sequence-b.event.sequence));request.onerror=()=>reject(request.error);});}
export function configureCloud(db,config){
  return new Promise((resolve,reject)=>{
    const tx=db.db.transaction(['snapshots','users','meta','outbox'],'readwrite'),state=tx.objectStore('snapshots').get('shop'),users=tx.objectStore('users').getAll(),meta=tx.objectStore('meta');
    meta.put({id:'cloud-config',value:config});meta.put({id:'cloud-sequence',value:0});meta.delete('cloud-last');meta.delete('cloud-ack');tx.objectStore('outbox').clear();
    users.onsuccess=()=>{if(state.result?.state)queueCloud(tx,snapshotOf(state.result.state,users.result));};
    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||Error('Could not configure backup'));
  });
}
export function acknowledgeCloud(db,streamId,cursor,versionId){
  return new Promise((resolve,reject)=>{const tx=db.db.transaction(['outbox','meta'],'readwrite'),store=tx.objectStore('outbox'),rows=store.getAll();rows.onsuccess=()=>{for(const row of rows.result)if(row.streamId===streamId&&row.event.sequence<=cursor)store.delete(row.id);tx.objectStore('meta').put({id:'cloud-ack',value:{streamId,cursor,versionId,at:Date.now()}});};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||Error('Could not acknowledge backup'));});
}
