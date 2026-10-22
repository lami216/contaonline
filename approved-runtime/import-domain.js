import {upgradeState,roundMoney,moneyAccountDelta,partyNetDelta} from './upgrade-state.js';
import {seedStockEvents} from './stock-domain.js';
import {executeLegacyImportPhase,preflightLegacyDatabase,inspectLegacyDatabase,LEGACY_IMPORT_PHASES} from './legacy-import.js';
const normalize=v=>String(v||'').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').trim().toLocaleLowerCase().replace(/\s+/g,' ');
const keyOf=(state,kind,row)=>row.importKey||row.desktopId&&'desktop:'+kind+':'+row.desktopId||'mobile:'+(state.originId||state.branding)+':'+kind+':'+row.id;
const num=v=>Number(v)||0;
export function reconcileImportOpening(state){
 state.opening={accounts:Object.fromEntries(state.accounts.map(a=>[a.id,a.balance])),parties:Object.fromEntries(state.parties.map(p=>[p.id,p.balance])),stocks:Object.fromEntries(state.products.map(p=>[p.id,{...p.stocks}]))};
 for(const r of state.records.filter(r=>!r.voided&&!r.reversedBy&&!r.reversalOf)){
  for(const a of state.accounts)state.opening.accounts[a.id]=roundMoney(state.opening.accounts[a.id]-moneyAccountDelta(r,a.id));
  if(r.party){const p=state.parties.find(p=>p.id===r.party);state.opening.parties[p.id]=roundMoney(state.opening.parties[p.id]-partyNetDelta(r)*(p.type==='supplier'?-1:1));}
  for(const l of r.lines){const stock=state.opening.stocks[l.product];if(r.kind==='sale')stock[r.warehouse]+=l.qty;if(r.kind==='purchase')stock[r.warehouse]-=l.qty;if(r.kind==='adjustment')stock[l.warehouse||r.warehouse]-=l.delta;if(r.kind==='stocktransfer'){stock[r.from]+=l.qty;stock[r.toWarehouse]-=l.qty}}
 }
 delete state.stockEvents;delete state.stockEventSequence;seedStockEvents(state);return state;
}
export function mergeImport(current,incoming,options={}){
 const next=structuredClone(current),source=structuredClone(incoming);upgradeState(next);upgradeState(source);
 const result={state:next,counts:{products:0,parties:0,accounts:0,warehouses:0,categories:0,records:0,existing:0},conflicts:[],warnings:[]},maps={products:new Map(),parties:new Map(),accounts:new Map(),categories:new Map(),warehouses:new Map()};
 const choices=options.matches||{},policy=kind=>options[kind]||'current',affectedProducts=new Set();
 for(const w of source.warehouses){let target=next.warehouses.find(x=>normalize(x)===normalize(w));if(!target){target=w;next.warehouses.push(w);next.warehouseMeta[w]={...source.warehouseMeta[w]};for(const p of next.products)p.stocks[w]=0;result.counts.warehouses++}maps.warehouses.set(w,target)}
 for(const c of source.categories){let target=next.categories.find(x=>normalize(x.name)===normalize(c.name));if(!target){target={...c,id:Math.max(0,...next.categories.map(x=>x.id))+1};next.categories.push(target);result.counts.categories++}maps.categories.set(c.id,target.id)}
 for(const kind of ['products','parties','accounts'])for(const row of source[kind]){
  const key=keyOf(source,kind,row),sameRole=x=>kind!=='parties'||x.type===row.type;
  let matches=next[kind].filter(x=>sameRole(x)&&(keyOf(next,kind,x)===key||x.importKeys?.includes(key)));
  if(!matches.length&&kind==='products'&&row.sku)matches=next[kind].filter(x=>x.sku===row.sku);
  if(!matches.length)matches=next[kind].filter(x=>sameRole(x)&&normalize(x.name)===normalize(row.name));
  let target=choices[key]==='new'?null:choices[key]?next[kind].find(x=>x.id===Number(choices[key])&&sameRole(x)):matches.length===1?matches[0]:null;
  if(matches.length>1&&!Object.hasOwn(choices,key)){result.conflicts.push({key,kind,name:row.name,candidates:matches.map(x=>({id:x.id,name:x.name}))});continue;}
  if(choices[key]&&choices[key]!=='new'&&!target)throw Error('اختيار مطابقة غير صالح');
  if(!target){target={...structuredClone(row),id:Math.max(0,...next[kind].map(x=>x.id))+1,importKey:key};if(kind==='products'){target.stocks=Object.fromEntries(next.warehouses.map(w=>[w,0]));for(const [w,q]of Object.entries(row.stocks))target.stocks[maps.warehouses.get(w)]=q;target.categoryId=maps.categories.get(row.categoryId)||null;target.openingWarehouse=maps.warehouses.get(row.openingWarehouse);target.qty=num(target.stocks[next.warehouse]);}next[kind].push(target);result.counts[kind]++;}
  else{result.counts.existing++;target.importKeys=[...new Set([...(target.importKeys||[]),key])];if(kind==='products'&&policy('stocks')==='imported'){for(const [w,q]of Object.entries(row.stocks))target.stocks[maps.warehouses.get(w)]=q;}if(kind!=='products'&&policy(kind)==='imported')target.balance=row.balance;}
  if(kind==='products'&&(target.importKey===key&&!current.products.some(p=>p.id===target.id)||policy('stocks')==='imported'&&JSON.stringify(current.products.find(p=>p.id===target.id)?.stocks)!==JSON.stringify(target.stocks)))affectedProducts.add(target.id);
  maps[kind].set(row.id,target.id);
 }
 if(result.conflicts.length)return result;
 const known=new Map(next.records.map(r=>[keyOf(next,'records',r),r]));
 for(const record of source.records){
  const key=keyOf(source,'records',record),old=known.get(key);if(old&&policy('records')!=='imported'){result.counts.existing++;continue;}
  const r={...structuredClone(record),id:old?.id||Math.max(100,...next.records.map(x=>x.id))+1,importKey:key};
  for(const name of ['account','to'])if(r[name]){r[name]=maps.accounts.get(r[name]);if(!r[name])throw Error('وسيلة دفع المستند غير موجودة')}
  if(r.party){r.party=maps.parties.get(r.party);if(!r.party)throw Error('طرف المستند غير موجود')}
  if(r.otherParty)throw Error('التقاص غير مدعوم');
  for(const name of ['warehouse','from','toWarehouse','openingWarehouseBefore','openingWarehouseAfter'])if(r[name])r[name]=maps.warehouses.get(r[name]);
  if(r.openingProduct)r.openingProduct=maps.products.get(r.openingProduct);
  r.lines=r.lines.map(line=>{const product=maps.products.get(line.product);if(!product)throw Error('منتج المستند غير موجود');return {...line,product,...(line.warehouse?{warehouse:maps.warehouses.get(line.warehouse)}:{})}});
  for(const line of [...(old?.lines||[]),...r.lines])affectedProducts.add(line.product);
  if(old)next.records[next.records.indexOf(old)]=r;else next.records.push(r);known.set(key,r);result.counts.records++;
 }
 next.records.sort((a,b)=>b.id-a.id);reconcileImportOpening(next);
 // Financial imports and repeated previews must not discard complete stock provenance.
 const affected=new Set([...affectedProducts].map(String)),oldEvents=current.stockEvents||[],offset=current.stockEventSequence||0;
 if(current.stockEvents){const rebuilt=next.stockEvents.filter(e=>affected.has(e.productId)).map(e=>({...e,documentRevision:(e.documentRevision||0)+offset}));next.stockEvents=[...oldEvents.filter(e=>!affected.has(e.productId)).map(e=>({...e})),...rebuilt];next.stockEventSequence=offset+(next.stockEventSequence||0);}
 for(const p of next.products){const old=current.products.find(x=>x.id===p.id);if(!old)continue;if(!affectedProducts.has(p.id)){if(old.openingHistoryLocked===undefined)delete p.openingHistoryLocked;else p.openingHistoryLocked=old.openingHistoryLocked;}else{p.openingHistoryLocked=true;}}
 if([...affectedProducts].some(id=>current.products.some(p=>p.id===id)))result.warnings.push('المنتجات المتطابقة ذات التاريخ المدمج تُراجع من سجل المخزون؛ لا يعاد تقدير رصيد بدايتها تلقائيًا.');
 upgradeState(next);return result;
}

export function memoryCollections(initial={}){
 const collections=structuredClone(initial),matches=(row,q)=>Object.entries(q||{}).every(([k,v])=>v&&typeof v==='object'&&v.$in?v.$in.includes(row[k]):row[k]===v);
 const set=(row,key,value)=>{const keys=key.split('.');let target=row;for(const k of keys.slice(0,-1))target=target[k]??={};target[keys.at(-1)]=value};
 return {collections,async transaction(fn){const before=structuredClone(collections);try{return await fn()}catch(e){for(const k of Object.keys(collections))delete collections[k];Object.assign(collections,before);throw e}},collection(name){const rows=collections[name]??=[];return {find(query={}){return {async toArray(){return rows.filter(r=>matches(r,query))}}},async bulkWrite(operations){for(const {updateOne:o}of operations){let row=rows.find(r=>matches(r,o.filter));if(!row&&o.upsert){row={...o.filter,...o.update.$setOnInsert};rows.push(row)}if(row)for(const [k,v]of Object.entries(o.update.$set||{}))set(row,k,v)}}}}};
}
export async function sqliteBackup(bytes,onProgress=()=>{}){
 if(bytes.byteLength>40*1024*1024)throw Error('الملف أكبر من 40 ميغابايت');
 const SQL=await globalThis.initSqlJs(),db=new SQL.Database(bytes);
 try{
  const names=db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values.flat().map(String)||[],collections={};
  const tables={products:'products',productCategories:'product_categories',parties:'parties',warehouses:'warehouses',documents:'documents',paymentAccounts:'payment_accounts',financialMovements:'financial_movements',stockMovements:'stock_movements',appSettings:'app_settings'};
  if(names.includes('products')&&names.includes('documents')){
   for(const [key,table]of Object.entries(tables)){if(!names.includes(table)){collections[key]=[];continue}const rows=db.exec('SELECT data_json FROM "'+table+'"')[0]?.values||[];if(rows.length>100000)throw Error('عدد السجلات يتجاوز الحد المدعوم');collections[key]=rows.map(([json])=>JSON.parse(json));onProgress(key,collections[key].length);await new Promise(r=>setTimeout(r,0))}
   return {format:'conta-backup',schemaVersion:1,createdAt:new Date().toISOString(),collections,warnings:[]};
  }
 }finally{db.close()}
 const target=memoryCollections({paymentAccounts:[{id:'cash',code:'cash',name:'نقدي',balance:0,isActive:true}],warehouses:[]}),preflight=await preflightLegacyDatabase(target,bytes);
 if(preflight.blockers.length)throw Error(preflight.blockers.slice(0,8).join(' · '));const preview=await inspectLegacyDatabase(bytes);
 for(const phase of LEGACY_IMPORT_PHASES){onProgress(phase,0);await executeLegacyImportPhase(target,bytes,phase);await new Promise(r=>setTimeout(r,0))}
 const c=target.collections;for(const w of c.warehouses)w.id??=w._id;
 for(const p of c.products)p.pieceCost??=p.legacyOpeningCost;
 return {format:'conta-backup',schemaVersion:1,createdAt:new Date().toISOString(),collections:{products:[],productCategories:[],parties:[],warehouses:[],documents:[],paymentAccounts:[],financialMovements:[],stockMovements:[],...c},warnings:[...preflight.warnings,...preview.warnings]};
}
