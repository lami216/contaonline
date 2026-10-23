// Narrow, versioned snapshot/delta contract; no service credentials or installation keys.
/** @param {string} key */
const safeKey=key=>typeof key==='string'&&key.length<120&&!['__proto__','prototype','constructor'].includes(key);
/** @param {any} snapshot @param {(state:any)=>unknown} validateState */
export function checkSnapshot(snapshot,validateState){
  if(!snapshot||snapshot.format!=='contaonline-backup'||snapshot.schemaVersion!==1||Object.keys(snapshot).some(key=>!['format','schemaVersion','state','users'].includes(key)))throw Error('Unsupported backup format');
  if(Object.keys(snapshot.state||{}).some(key=>!safeKey(key)))throw Error('Invalid state property');validateState(snapshot.state);
  const users=/** @type {any[]} */(snapshot.users);if(!Array.isArray(users)||users.length>1000||!users.some(u=>u.role==='owner'&&u.active!==false))throw Error('Backup needs a local owner');
  for(const u of users)if(!u.id||!u.username||!['owner','manager','accountant','sales','custom'].includes(u.role)||!/^[a-f0-9]{64}$/.test(u.password?.hash||'')||!/^[a-f0-9]{32}$/.test(u.password?.salt||''))throw Error('Invalid backup user');
  if(new Set(users.map(u=>u.id)).size!==users.length||new Set(users.map(u=>u.username)).size!==users.length)throw Error('Duplicate backup user');
  return snapshot;
}
/** @param {any} a @param {any} b */
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/** @param {any} value @returns {value is any[]} */
const keyed=value=>Array.isArray(value)&&value.every(row=>row&&typeof row==='object'&&(typeof row.id==='string'||Number.isSafeInteger(row.id)))&&new Set(value.map(row=>row.id)).size===value.length;
/** @param {any} previous @param {any} next */
export function diffSnapshot(previous,next){
  const operations=[];
  for(const key of new Set([...Object.keys(previous.state),...Object.keys(next.state)])){
    if(!safeKey(key))throw Error('Invalid property');const before=previous.state[key],after=next.state[key];if(equal(before,after))continue;
    if(after===undefined){operations.push({op:'drop',key});continue;}
    if(keyed(before)&&keyed(after)){
      const old=new Map(before.map(row=>[row.id,row])),current=new Set(after.map(row=>row.id));
      for(const row of before)if(!current.has(row.id))operations.push({op:'remove',key,id:row.id});
      for(const row of after)if(!equal(old.get(row.id),row))operations.push({op:'upsert',key,value:row});
      const remaining=before.filter(row=>current.has(row.id)).map(row=>row.id),appended=after.filter(row=>!old.has(row.id)).map(row=>row.id);
      if(!equal([...remaining,...appended],after.map(row=>row.id)))operations.push({op:'order',key,ids:after.map(row=>row.id)});
    }else operations.push({op:'set',key,value:after});
  }
  if(!equal(previous.users,next.users))operations.push({op:'users',value:next.users});return operations;
}
/** @param {any} previous @param {any[]} operations @param {(state:any)=>unknown} validateState */
export function applyDelta(previous,operations,validateState){
  if(!Array.isArray(operations)||operations.length>10000)throw Error('Oversized delta');const next=structuredClone(previous);
  for(const op of operations){
    if(op.op==='users'){next.users=structuredClone(op.value);continue;}
    if(!safeKey(op.key))throw Error('Invalid delta key');
    if(op.op==='set')next.state[op.key]=structuredClone(op.value);
    else if(op.op==='drop')delete next.state[op.key];
    else if(['upsert','remove','order'].includes(op.op)){
      const rows=next.state[op.key];if(!keyed(rows))throw Error('Delta requires a keyed collection');
      if(op.op==='upsert'){if(!op.value||op.value.id===undefined)throw Error('Invalid delta row');const index=rows.findIndex(row=>row.id===op.value.id);if(index<0)rows.push(structuredClone(op.value));else rows[index]=structuredClone(op.value);}
      else if(op.op==='remove'){const index=rows.findIndex(row=>row.id===op.id);if(index<0)throw Error('Missing delta row');rows.splice(index,1);}
      else{if(!Array.isArray(op.ids)||op.ids.length!==rows.length||new Set(op.ids).size!==rows.length)throw Error('Invalid row order');const map=new Map(rows.map(row=>[row.id,row]));const ids=/** @type {Array<string|number>} */(op.ids);if(ids.some(id=>!map.has(id)))throw Error('Unknown row in order');next.state[op.key]=ids.map(id=>map.get(id));}
    }else throw Error('Unsupported delta operation');
  }
  return checkSnapshot(next,validateState);
}
