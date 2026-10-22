// Additive approved-runtime state, following the desktop settings and sequence contracts.
export const FEATURE_SCHEMA=2;
export const roundMoney=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
export function currencyCode(state){return /^[A-Z]{3}$/.test(state?.currency?.code||'')?state.currency.code:'MRU'}
export function validateCurrency(value){
 const code=String(value.code||'').trim().toUpperCase(),input=value.availableCodes||[];
 if(!/^[A-Z]{3}$/.test(code)||!Array.isArray(input)||input.length>30)throw Error('رمز العملة يجب أن يتكون من 3 أحرف إنجليزية');
 const availableCodes=[...new Set(['MRU',...input.map(v=>String(v).trim().toUpperCase()),code])];
 if(availableCodes.some(v=>!/^[A-Z]{3}$/.test(v))||availableCodes.length>30)throw Error('قائمة العملات غير صالحة');
 return {code,availableCodes};
}
export function upgradeState(state){
 const before=JSON.stringify(state);
 state.currency=validateCurrency(state.currency||{code:'MRU',availableCodes:['MRU']});state.categories??=[];
 state.warehouseMeta??={};for(const name of state.warehouses)state.warehouseMeta[name]??={archived:false};
 state.salesWarehouse??=state.warehouse;state.sequences??={};state.brandInfo??={};
 for(const a of state.accounts)if(a.active===undefined)a.active=!a.archived;
 for(const kind of ['sale','purchase','expense']){
  const records=state.records.filter(r=>r.kind===kind).slice().sort((a,b)=>a.id-b.id),used=new Set(records.map(r=>r.sequence).filter(Number.isSafeInteger));let next=0;
  for(const r of records){if(!r.sequence){while(used.has(++next)){}r.sequence=next;used.add(next)}r.number??=r.kind.toUpperCase()+'-'+r.id;}
  state.sequences[kind]=Math.max(state.sequences[kind]||0,0,...used);
 }
 state.originId??=crypto.randomUUID();state.featureSchema=FEATURE_SCHEMA;
 return before!==JSON.stringify(state);
}
export function nextDocumentNumber(state,kind){return Math.max(state.sequences?.[kind]||0,0,...state.records.filter(r=>r.kind===kind).map(r=>Number(r.sequence)||0))+1}
export function validateFeatureState(state){
 if(state.currency)validateCurrency(state.currency);
 if(state.categories){if(!Array.isArray(state.categories)||state.categories.length>10000)throw Error('قائمة الفئات غير صالحة');const ids=new Set(),names=new Set();for(const c of state.categories){const name=String(c.name||'').trim().toLocaleLowerCase();if(!Number.isSafeInteger(c.id)||c.id<=0||!name||ids.has(c.id)||names.has(name))throw Error('فئة مكررة أو غير صالحة');ids.add(c.id);names.add(name)}for(const p of state.products)if(p.categoryId&&!ids.has(p.categoryId))throw Error('فئة المنتج غير موجودة');}
 if(state.salesWarehouse&&!state.warehouses.includes(state.salesWarehouse))throw Error('مخزن البيع غير موجود');
 if(state.warehouseMeta&&state.warehouses.some(w=>!state.warehouseMeta[w]||typeof state.warehouseMeta[w].archived!=='boolean'))throw Error('بيانات المخزن غير صالحة');
 for(const p of state.products)if(p.openingCost!=null&&(!Number.isFinite(p.openingCost)||p.openingCost<0))throw Error('تكلفة رصيد البداية غير صالحة');
 if(state.warehouses.some(w=>['__proto__','constructor','prototype'].includes(w)||w.length>120))throw Error('اسم مخزن غير صالح');
 const finite=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e14;
 if(state.brandInfo){const b=state.brandInfo;if(b.logo&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo)||b.logo.length>700000))throw Error('صورة شعار غير صالحة');if(b.nameFont&&!['tahoma','arial','segoe-ui','times-new-roman'].includes(b.nameFont)||b.nameFontSize!=null&&(!finite(b.nameFontSize)||b.nameFontSize<16||b.nameFontSize>32)||b.nameFontWeight!=null&&![400,600,800].includes(b.nameFontWeight))throw Error('إعدادات خط غير صالحة');}
 for(const a of state.accounts)if(a.openingBalance!=null&&(!finite(a.openingBalance)||a.openingBalance<0))throw Error('رصيد بداية غير صالح');
 for(const r of state.records){for(const l of r.lines||[])if(l.warehouse&&!state.warehouses.includes(l.warehouse))throw Error('المخزن غير موجود');if(r.openingCorrection&&(!state.products.some(p=>p.id===r.openingProduct)||!['openingTotalBefore','openingTotalAfter','openingCostBefore','openingCostAfter'].every(k=>finite(r[k])&&r[k]>=0)))throw Error('تصحيح رصيد البداية غير صالح');}
 if(state.stockEvents){if(!Array.isArray(state.stockEvents)||state.stockEvents.length>1000000)throw Error('سجل المخزون غير صالح');const products=new Set(state.products.map(p=>String(p.id))),warehouses=new Set(state.warehouses);for(const e of state.stockEvents)if(!products.has(e.productId)||!warehouses.has(e.warehouseId)||!finite(e.quantityDelta))throw Error('حركة مخزون غير صالحة');}
 return true;
}
export function setCategory(state,id,name){
 const value=String(name||'').trim();if(!value||value.length>80||state.categories.some(c=>c.id!==id&&c.name.toLocaleLowerCase()===value.toLocaleLowerCase()))throw Error('أدخل اسم فئة فريدًا');
 if(id){const c=state.categories.find(c=>c.id===id);if(!c)throw Error('الفئة غير موجودة');c.name=value;return id;}
 const next=Math.max(0,...state.categories.map(c=>c.id))+1;state.categories.push({id:next,name:value});return next;
}
export function deleteCategory(state,id){state.categories=state.categories.filter(c=>c.id!==id);for(const p of state.products)if(p.categoryId===id)p.categoryId=null;}
export function archiveParty(state,id){const p=state.parties.find(p=>p.id===id);if(!p)throw Error('الحساب غير موجود');if(Math.abs(p.balance)>.005)throw Error('لا يمكن أرشفة حساب لديه رصيد قائم');p.archived=true;}
export function archiveWarehouse(state,name){
 if(!state.warehouses.includes(name))throw Error('المخزن غير موجود');
 if(state.salesWarehouse===name)throw Error('عيّن مخزن بيع آخر أولًا');
 if(state.products.some(p=>Object.values({quantity:p.stocks[name]||0}).some(q=>q!==0)))throw Error('المخزن يحتوي على بضاعة');
 // Keep the identity and historical references; every picker excludes archived warehouses.
 state.warehouseMeta[name]={...state.warehouseMeta[name],archived:true};if(state.warehouse===name)state.warehouse=state.salesWarehouse;
}
export function activeWarehouses(state){return state.warehouses.filter(w=>!state.warehouseMeta?.[w]?.archived)}
export function partyNetDelta(record){
 if(record.kind==='sale')return Number(record.due)||0;if(record.kind==='purchase')return -(Number(record.due)||0);
 if(record.kind==='receive')return -Number(record.total);if(record.kind==='pay')return Number(record.total);return 0;
}
export function moneyAccountDelta(record,id){
 let value=record.account===id?(['sale','receive','deposit'].includes(record.kind)?Number(record.paid||0):-Number(record.paid||0)):0;
 if(record.kind==='transfer'&&record.to===id)value+=Number(record.total);return roundMoney(value);
}
