import {deriveOpeningStockState,planOpeningStockCorrection} from './desktop-opening.js';
import {roundMoney} from './upgrade-state.js';

export function recordStockEvents(state,record,sign=1,phase='post'){
 state.stockEvents??=[];state.stockEventSequence=(state.stockEventSequence||0)+1;const revision=state.stockEventSequence;
 const push=(line,warehouse,delta,type)=>{if(!delta)return;state.stockEvents.push({productId:String(line.product),documentId:String(record.id),documentRevision:revision,warehouseId:warehouse,quantityDelta:delta,type,at:new Date().toISOString()})};
 for(const line of record.lines||[]){const type=record.openingStock?'opening':record.openingCorrection?'opening-correction':record.kind;
  const suffix=sign<0?(phase==='void'?'-void':'-edit'):phase==='edit'?'-edit':'';
  if(['sale','purchase'].includes(record.kind))push(line,record.warehouse,sign*(record.kind==='sale'?-1:1)*line.qty,type+suffix);
  else if(record.kind==='adjustment')push(line,line.warehouse||record.warehouse,sign*line.delta,type+suffix);
  else if(record.kind==='stocktransfer'){push(line,record.from,-sign*line.qty,phase==='post'?'transfer-out':'transfer-'+phase);push(line,record.toWarehouse,sign*line.qty,phase==='post'?'transfer-in':'transfer-'+phase)}
 }
}
export function seedStockEvents(state){
 if(state.stockEvents)return false;
 state.stockEvents=[];state.stockEventSequence=0;
 for(const p of state.products){
  for(const [warehouse,qty]of Object.entries(state.opening.stocks[p.id]||{}))if(qty)state.stockEvents.push({productId:String(p.id),documentId:'legacy-'+p.id,warehouseId:warehouse,quantityDelta:qty,type:'legacy-opening'});
  if(state.records.some(r=>(r.voided||r.revision>0)&&r.lines?.some(l=>l.product===p.id)))p.openingHistoryLocked=true;
 }
 for(const r of state.records.filter(r=>!r.voided).slice().sort((a,b)=>a.id-b.id))recordStockEvents(state,r);
 return true;
}
export async function openingState(state,product){
 seedStockEvents(state);
 const docs=state.records.map(r=>({...r,id:String(r.id),occurredAt:r.date,lines:(r.lines||[]).map(l=>({...l,productId:String(l.product),unitPrice:l.price}))}));
 const fake={collection(name){return {find(query){let rows=name==='stockMovements'?state.stockEvents.filter(r=>r.productId===query.productId):docs.filter(r=>query.id?.$in?.includes(r.id));return {sort(){return this},async toArray(){return rows}}}}}};
 const nativeTotal=state.records.filter(r=>!r.voided&&r.openingStock).reduce((sum,r)=>sum+r.lines.filter(l=>l.product===product.id).reduce((n,l)=>n+l.delta,0),0);
 return deriveOpeningStockState(fake,undefined,{...product,id:String(product.id),openingStock:product.openingTotal??nativeTotal,openingCost:product.openingCost??state.records.find(r=>r.openingStock&&!r.voided&&r.lines.some(l=>l.product===product.id))?.lines.find(l=>l.product===product.id)?.price,openingWarehouseId:product.openingWarehouse,legacyOpeningCost:product.legacyOpeningCost});
}
export function planOpeningRecord(state,product,provenance,desiredTotal,desiredCost,warehouse,relocate,id,date,time,note){
 if(product.openingHistoryLocked||!provenance.hasNativeOpening&&provenance.hasStockHistory)throw Error('رصيد البداية التاريخي غير قابل للتعديل؛ راجع سجل الحركات');
 if(!note?.trim())throw Error('أدخل سبب التصحيح');
 if(desiredTotal>0&&(!Number.isFinite(desiredCost)||desiredCost<=0))throw Error('تكلفة رصيد البداية يجب أن تكون أكبر من صفر');
 if(!state.warehouses.includes(warehouse)||state.warehouseMeta?.[warehouse]?.archived)throw Error('اختر مخزنًا فعالًا');
 const plan=planOpeningStockCorrection(provenance,desiredTotal,warehouse,relocate);
 for(const item of plan.deltas)if((product.stocks[item.warehouseId]||0)+item.delta<0)throw Error('التصحيح يتجاوز المخزون المتاح');
 return {id,kind:'adjustment',date,time,lines:plan.deltas.map(item=>({product:product.id,name:product.name,warehouse:item.warehouseId,qty:Math.abs(item.delta),delta:item.delta,price:desiredCost})),total:0,paid:0,due:0,warehouse,title:product.name,subtitle:'تصحيح رصيد البداية',openingCorrection:true,openingProduct:product.id,openingTotalBefore:provenance.total,openingTotalAfter:desiredTotal,openingCostBefore:provenance.cost??product.cost,openingCostAfter:desiredCost,openingWarehouseBefore:provenance.warehouseId,openingWarehouseAfter:warehouse,note:note.trim()};
}
export function applyOpeningMetadata(state,record,reverse=false){
 if(!record.openingCorrection)return;const p=state.products.find(p=>p.id===record.openingProduct),suffix=reverse?'Before':'After';
 p.openingTotal=record['openingTotal'+suffix];p.openingCost=record['openingCost'+suffix];p.openingWarehouse=record['openingWarehouse'+suffix];
 const purchase=state.records.filter(r=>!r.voided&&r.kind==='purchase'&&r.lines.some(l=>l.product===p.id)).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id).at(-1);
 p.cost=purchase?.lines.find(l=>l.product===p.id)?.price??p.openingCost??p.cost;
}
export function stockOperationRecord(state,mode,draft,existing,id,date,time){
 if(!['transfer','adjustment'].includes(mode)||!state.warehouses.includes(draft.from)||state.warehouseMeta?.[draft.from]?.archived)throw Error('اختر المخزن');
 if(mode==='transfer'&&(!state.warehouses.includes(draft.to)||draft.to===draft.from||state.warehouseMeta?.[draft.to]?.archived))throw Error('اختر مخزنين مختلفين');
 if(!draft.lines.length||new Set(draft.lines.map(l=>l.product)).size!==draft.lines.length)throw Error('أضف منتجات مختلفة إلى العملية');
 const lines=draft.lines.map(line=>{const p=state.products.find(p=>p.id===line.product&&!p.archived);if(!p)throw Error('المنتج غير موجود');const qty=Number(line.quantity);if(!Number.isFinite(qty)||qty<0||mode==='transfer'&&qty===0)throw Error('أدخل كمية صحيحة');
  const old=existing?.lines.find(l=>l.product===p.id),base=(p.stocks[draft.from]||0)-(existing?.kind==='adjustment'&&existing.warehouse===draft.from?(old?.delta||0):0)+(existing?.kind==='stocktransfer'&&existing.from===draft.from?(old?.qty||0):0)-(existing?.kind==='stocktransfer'&&existing.toWarehouse===draft.from?(old?.qty||0):0);
  if(mode==='transfer'&&qty>base)throw Error('الكمية المطلوبة أكبر من المخزون');
  return {product:p.id,name:p.name,qty:mode==='transfer'?qty:Math.abs(qty-base),delta:mode==='transfer'?0:roundMoney(qty-base),price:p.cost,actualQuantity:mode==='adjustment'?qty:undefined};
 });
 if(mode==='adjustment'&&!draft.note?.trim())throw Error('أدخل سبب التصحيح');
 return {id,kind:mode==='transfer'?'stocktransfer':'adjustment',date,time,lines,from:mode==='transfer'?draft.from:undefined,toWarehouse:mode==='transfer'?draft.to:undefined,warehouse:mode==='adjustment'?draft.from:undefined,newQty:lines.length===1?lines[0].actualQuantity:undefined,title:lines.length===1?lines[0].name:'حركة مخزون',subtitle:mode==='transfer'?'تحويل مخزون':'تصحيح مخزون',note:draft.note||'',total:mode==='transfer'?roundMoney(lines.reduce((n,l)=>n+l.qty*l.price,0)):roundMoney(lines.reduce((n,l)=>n+Math.abs(l.delta)*l.price,0)),paid:0,due:0};
}
