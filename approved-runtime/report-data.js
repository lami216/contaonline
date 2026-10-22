import {currencyCode,partyNetDelta,moneyAccountDelta,roundMoney} from './upgrade-state.js';
import {effectivePartyRecord,partyNetBalance} from './party-metrics.js';
import {translateText} from './i18n.js';

export const reportTitles={overview:'التقرير الشامل',sales:'حركة المبيعات',purchases:'حركة المشتريات','product-sales':'حركة المنتجات',stock:'حركة المخزون',profit:'تحليل الأرباح',debts:'الحسابات والديون','party-ledger':'كشف حسابات الأطراف',financial:'الحركة المالية',expenses:'المصاريف'};
const n=v=>Number(v)||0,sum=(rows,get)=>roundMoney(rows.reduce((s,r)=>s+n(get(r)),0));
const columns=(...items)=>items.map(([key,label,format='text'])=>({key,label,format}));
const matches=(text,search)=>{const normalize=v=>String(v||'').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').toLocaleLowerCase();return normalize(search).split(/\s+/).filter(Boolean).every(word=>normalize(text).includes(word))};
function validDate(date){try{return /^\d{4}-\d{2}-\d{2}$/.test(date||'')&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date}catch{return false}}
export function normalizeReportFilters(state,filters={}){
 const f={type:'overview',allTime:true,from:'',to:'',partyId:'',partyType:'',productId:'',categoryId:'',accountId:'',warehouse:'',direction:'',debtSide:'',movementType:'',groupBy:'invoice',search:'',...filters};
 if(!reportTitles[f.type])throw Error('نوع التقرير غير صالح');
 if(!f.allTime&&(!validDate(f.from)||!validDate(f.to)||f.from>f.to))throw Error('أدخل فترة صحيحة');
 for(const [key,list] of [['partyId',state.parties],['productId',state.products],['categoryId',state.categories||[]],['accountId',state.accounts]])if(f[key]&&!list.some(x=>x.id===Number(f[key])))throw Error('اختيار التقرير غير موجود');
 if(f.warehouse&&!state.warehouses.includes(f.warehouse))throw Error('المخزن غير موجود');return f;
}
export function reportDataset(state,filters={}){
 const f=normalizeReportFilters(state,filters),all=state.records.filter(effectivePartyRecord),inRange=r=>f.allTime||r.date>=f.from&&r.date<=f.to;
 const byProduct=line=>(!f.productId||line.product===Number(f.productId))&&(!f.categoryId||state.products.find(p=>p.id===line.product)?.categoryId===Number(f.categoryId));
 const byContext=r=>(!f.accountId||r.account===Number(f.accountId)||r.to===Number(f.accountId))&&(!f.partyId||r.party===Number(f.partyId))&&(!f.warehouse||[r.warehouse,r.from,r.toWarehouse].includes(f.warehouse));
 const records=all.filter(r=>inRange(r)&&byContext(r)&&(!f.productId&&!f.categoryId||(r.lines||[]).some(byProduct))).sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
 const title=reportTitles[f.type],result={type:f.type,title,filters:f,currency:currencyCode(state),columns:[],rows:[],metrics:[],records:[],opening:null,closing:null,warnings:[]};
 const lineCost=(r,l)=>Number.isFinite(l.costAtSale)?l.qty*l.costAtSale:Number.isFinite(l.grossProfit)?l.qty*l.price-l.grossProfit:r.lines.length===1&&Number.isFinite(r.profit)?r.total-r.profit:null;
 const metric=(label,value,format='money')=>({label,value:roundMoney(value),format});
 const docRow=r=>({id:r.id,action:'invoice:'+r.id,number:r.number||r.kind.toUpperCase()+'-'+r.id,date:r.date,party:state.parties.find(p=>p.id===r.party)?.name||r.title||'',kind:r.kind,total:n(r.total),paid:n(r.paid),due:n(r.due),cost:r.kind==='sale'?n(r.total)-n(r.profit):0,profit:n(r.profit),account:state.accounts.find(a=>a.id===r.account)?.name||'—',note:r.note||''});
 if(['sales','purchases','expenses','overview','profit'].includes(f.type)){
  const kinds=f.type==='sales'?['sale']:f.type==='purchases'?['purchase']:f.type==='expenses'?['expense']:f.type==='profit'?['sale','expense']:['sale','purchase','expense'];
  result.records=records.filter(r=>kinds.includes(r.kind));
  result.rows=result.records.map(r=>{
   const row=docRow(r);if(['sale','purchase'].includes(r.kind)&&(f.productId||f.categoryId)){
    const selected=r.lines.filter(byProduct),portion=sum(selected,l=>l.qty*l.price),ratio=r.total?portion/r.total:0;row.total=portion;row.paid=roundMoney(r.paid*ratio);row.due=roundMoney(r.due*ratio);const known=selected.every(l=>lineCost(r,l)!==null);row.cost=known?sum(selected,l=>lineCost(r,l)):null;row.profit=known?roundMoney(row.total-row.cost):null;if(!known)result.warnings.push('الأرباح المعروضة تستثني الصفوف التي تنقصها التكلفة التاريخية.');
   }return row;
  });
  result.columns=columns(['number','رقم الفاتورة'],['date','التاريخ'],['party','الطرف / البيان'],['total','الإجمالي','money'],['paid','المدفوع','money'],['due','على الحساب','money']);
  const sales=result.rows.filter(r=>r.kind==='sale'),purchases=result.rows.filter(r=>r.kind==='purchase'),expenses=result.rows.filter(r=>r.kind==='expense');
  if(f.type==='sales')result.metrics=[metric('المبيعات',sum(sales,r=>r.total)),metric('عدد العمليات',sales.length,'count'),metric('المدفوع عند البيع',sum(sales,r=>r.paid)),metric('الآجل عند البيع',sum(sales,r=>r.due)),metric('صافي العملاء',sum(state.parties.filter(p=>p.type==='customer'),p=>p.balance))];
  else if(f.type==='purchases')result.metrics=[metric('المشتريات',sum(purchases,r=>r.total)),metric('عدد العمليات',purchases.length,'count'),metric('المدفوع عند الشراء',sum(purchases,r=>r.paid)),metric('الآجل عند الشراء',sum(purchases,r=>r.due))];
  else if(f.type==='expenses')result.metrics=[metric('المصاريف',sum(expenses,r=>r.total)),metric('عدد العمليات',expenses.length,'count')];
  else{result.columns=columns(['number','رقم الفاتورة'],['date','التاريخ'],['kind','النوع'],['party','الطرف / البيان'],['total','الإجمالي','money'],['cost','تكلفة البيع','money'],['profit','الربح','money']);result.metrics=[metric('المبيعات',sum(sales,r=>r.total)),metric('تكلفة البيع',sum(sales,r=>r.cost)),metric('الربح الإجمالي',sum(sales,r=>r.profit)),metric('المصاريف',sum(expenses,r=>r.total)),metric('صافي الربح',sum(sales,r=>r.profit)-sum(expenses,r=>r.total))];}
  if(f.type==='overview'){
   result.metrics=[metric('الأرصدة',sum(state.accounts,a=>a.balance)),metric('قيمة المخزون',sum(state.products,p=>sum(Object.values(p.stocks),q=>q)*p.cost)),metric('لنا',sum(state.parties,p=>Math.max(0,partyNetBalance(p)))),metric('علينا',sum(state.parties,p=>Math.max(0,-partyNetBalance(p)))),metric('المبيعات',sum(sales,r=>r.total)),metric('المشتريات',sum(purchases,r=>r.total)),metric('المصاريف',sum(expenses,r=>r.total)),metric('صافي الربح',sum(sales,r=>r.profit)-sum(expenses,r=>r.total))];
   result.currentAccounts=state.accounts.map(a=>({name:a.name,balance:a.balance}));result.currentParties=state.parties.map(p=>({name:p.name,receivable:Math.max(0,partyNetBalance(p)),payable:Math.max(0,-partyNetBalance(p))}));
  }
 }else if(f.type==='party-ledger'){
  const party=state.parties.find(p=>p.id===Number(f.partyId));result.columns=columns(['date','التاريخ'],['number','رقم المستند'],['kind','النوع'],['change','الحركة','money'],['debit','لنا','money'],['credit','علينا','money'],['balance','الرصيد','money']);
  if(!party){result.needsParty=true;return result}
  result.party=party;const history=all.filter(r=>r.party===party.id).sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
  let balance=n(state.opening.parties[party.id])*(party.type==='supplier'?-1:1);
  for(const r of history.filter(r=>!f.allTime&&r.date<f.from))balance=roundMoney(balance+partyNetDelta(r));
  result.opening=balance;result.rows.push({id:'opening',date:f.allTime?'—':f.from,number:'—',kind:'رصيد البداية',change:0,debit:0,credit:0,balance});
  for(const r of history.filter(inRange)){const delta=partyNetDelta(r);balance=roundMoney(balance+delta);result.rows.push({id:r.id,action:'invoice:'+r.id,date:r.date,number:r.number||r.kind.toUpperCase()+'-'+r.id,kind:r.kind,change:delta,debit:Math.max(0,delta),credit:Math.max(0,-delta),balance});result.records.push(r)}
  result.closing=balance;result.metrics=[metric('رصيد البداية',result.opening),metric('الحركات لنا',sum(result.rows,r=>r.debit)),metric('الحركات علينا',sum(result.rows,r=>r.credit)),metric('الرصيد النهائي',balance)];
 }else if(f.type==='debts'){
  result.columns=columns(['party','الحساب'],['type','النوع'],['phone','الهاتف'],['receivable','لنا','money'],['payable','علينا','money']);
  result.rows=state.parties.filter(p=>!p.archived&&(!f.partyId||p.id===Number(f.partyId))&&(!f.partyType||p.type===f.partyType)&&matches(p.name+' '+p.phone,f.search)).map(p=>({id:p.id,action:'ledger:'+p.id,party:p.name,type:p.type,phone:p.phone||'',receivable:Math.max(0,partyNetBalance(p)),payable:Math.max(0,-partyNetBalance(p))})).filter(r=>f.debtSide==='receivable'?r.receivable>0:f.debtSide==='payable'?r.payable>0:f.debtSide==='clear'?r.receivable===0&&r.payable===0:true);
  result.metrics=[metric('لنا',sum(result.rows,r=>r.receivable)),metric('علينا',sum(result.rows,r=>r.payable)),metric('عدد الحسابات',result.rows.length,'count')];
 }else if(f.type==='product-sales'){
  const grouped=new Map();for(const r of records.filter(r=>r.kind==='sale'))for(const l of r.lines.filter(byProduct)){const p=state.products.find(p=>p.id===l.product),row=grouped.get(l.product)||{id:l.product,action:'product:'+l.product,product:p?.name||l.name,quantity:0,total:0,cost:0};row.quantity+=l.qty;row.total=roundMoney(row.total+l.qty*l.price);const cost=lineCost(r,l);if(cost===null)row.unknownCost=true;else row.cost=roundMoney(row.cost+cost);grouped.set(l.product,row)}
  result.rows=[...grouped.values()].map(r=>({...r,average:r.quantity?r.total/r.quantity:0,profit:r.unknownCost?null:roundMoney(r.total-r.cost)}));result.records=records.filter(r=>r.kind==='sale');if(result.rows.some(r=>r.unknownCost))result.warnings.push('الأرباح المعروضة تستثني الصفوف التي تنقصها التكلفة التاريخية.');
  result.columns=columns(['product','المنتج'],['quantity','الكمية','number'],['average','متوسط السعر','money'],['total','المبيعات','money'],['profit','الربح','money']);result.metrics=[metric('الوحدات المباعة',sum(result.rows,r=>r.quantity),'count'),metric('المبيعات',sum(result.rows,r=>r.total)),metric('الربح الإجمالي',sum(result.rows,r=>r.profit))];
 }else if(f.type==='stock'){
  result.columns=columns(['date','التاريخ'],['product','المنتج'],['warehouse','المخزن'],['kind','النوع'],['before','قبل','number'],['delta','التغيير','number'],['after','بعد','number']);const balances=structuredClone(state.opening.stocks);
  for(const r of all.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id))for(const l of r.lines||[]){const p=state.products.find(p=>p.id===l.product);let moves=[];if(['sale','purchase'].includes(r.kind))moves=[[r.warehouse,(r.kind==='sale'?-1:1)*l.qty]];else if(r.kind==='stocktransfer')moves=[[r.from,-l.qty],[r.toWarehouse,l.qty]];else if(r.kind==='adjustment')moves=[[l.warehouse||r.warehouse,l.delta]];
   for(const [warehouse,delta]of moves){balances[l.product]??={};const before=n(balances[l.product][warehouse]);balances[l.product][warehouse]=roundMoney(before+delta);if(inRange(r)&&byProduct(l)&&(!f.warehouse||f.warehouse===warehouse)&&(!f.movementType||f.movementType===r.kind))result.rows.push({id:r.id+'-'+l.product+'-'+warehouse,action:'invoice:'+r.id,date:r.date,product:p?.name||l.name,warehouse,kind:r.openingStock?'رصيد البداية':r.kind,before,delta,after:balances[l.product][warehouse]});}
  }
  const products=state.products.filter(p=>(!f.productId||p.id===Number(f.productId))&&(!f.categoryId||p.categoryId===Number(f.categoryId))),quantity=p=>f.warehouse?n(p.stocks[f.warehouse]):sum(Object.values(p.stocks),q=>q);
  result.metrics=[metric('قيمة المخزون',sum(products,p=>quantity(p)*p.cost)),metric('الوحدات',sum(products,quantity),'count'),metric('عدد المنتجات',products.length,'count'),metric('الداخل',sum(result.rows,r=>Math.max(0,r.delta)),'count'),metric('الخارج',sum(result.rows,r=>Math.max(0,-r.delta)),'count')];
  result.stockBalances=products.map(p=>({id:p.id,action:'explain:audit:product:'+p.id,product:p.name,quantity:quantity(p),value:roundMoney(quantity(p)*p.cost)}));
 }else if(f.type==='financial'){
  result.columns=columns(['date','التاريخ'],['number','رقم المستند'],['account','الحساب'],['kind','النوع'],['incoming','الداخل','money'],['outgoing','الخارج','money'],['balance','الرصيد','money']);const balances={...state.opening.accounts};
  for(const r of all.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id))for(const a of state.accounts){const delta=moneyAccountDelta(r,a.id);if(!delta)continue;balances[a.id]=roundMoney(n(balances[a.id])+delta);if(!inRange(r)||f.accountId&&a.id!==Number(f.accountId)||f.direction==='in'&&delta<0||f.direction==='out'&&delta>0)continue;result.rows.push({id:r.id+'-'+a.id,action:'invoice:'+r.id,date:r.date,number:r.number||r.kind.toUpperCase()+'-'+r.id,account:a.name,kind:r.kind,incoming:Math.max(delta,0),outgoing:Math.max(-delta,0),balance:balances[a.id]});}
  result.metrics=[metric('الداخل',sum(result.rows,r=>r.incoming)),metric('الخارج',sum(result.rows,r=>r.outgoing)),metric('الصافي',sum(result.rows,r=>r.incoming-r.outgoing))];
 }
 result.warnings=[...new Set(result.warnings)];if(result.warnings.length)for(const m of result.metrics)if(m.label.includes('ربح')||m.label==='تكلفة البيع')m.label+=m.label==='تكلفة البيع'?' المثبتة':' المثبت';return result;
}
export function reportOutputModel(state,data,{language='ar',labels={}}={}){
 const t=v=>translateText(v,language),display=(value,column)=>value===null?'—':column.format==='money'?Number(value||0).toLocaleString(language==='fr'?'fr-FR':'en-US',{maximumFractionDigits:2})+' '+data.currency:column.key==='kind'?t(labels[value]||value):column.key==='type'?t(value==='supplier'?'مورد':'عميل'):column.key==='date'?t(value):value;
 const blocks=[{kind:'heading',text:t(data.title)},{kind:'text',text:data.filters.allTime?t('كل الفترة'):t(data.filters.from)+' — '+t(data.filters.to)}];
 if(data.party)blocks.push({kind:'text',text:data.party.name});
 for(const warning of data.warnings||[])blocks.push({kind:'text',text:t(warning)});
 const selections=[['productId',state.products,'المنتج'],['categoryId',state.categories||[],'الفئة'],['accountId',state.accounts,'وسيلة الدفع']];for(const [key,list,label]of selections)if(data.filters[key])blocks.push({kind:'text',text:t(label)+': '+list.find(x=>x.id===Number(data.filters[key]))?.name});
 blocks.push({kind:'table',rows:[[t('البيان'),t('القيمة')],...data.metrics.map(m=>[t(m.label),m.format==='money'?Number(m.value).toLocaleString(language==='fr'?'fr-FR':'en-US',{maximumFractionDigits:2})+' '+data.currency:m.value])]});
 blocks.push({kind:'table',rows:[data.columns.map(c=>t(c.label)+(c.format==='money'?' '+data.currency:'')),...data.rows.map(r=>data.columns.map(c=>display(r[c.key],c)))]});
 if(data.stockBalances)blocks.push({kind:'subheading',text:t('الرصيد الحالي')},{kind:'table',rows:[[t('المنتج'),t('الكمية'),t('القيمة')+' '+data.currency],...data.stockBalances.map(r=>[r.product,r.quantity,r.value])]});
 if(data.currentAccounts)blocks.push({kind:'subheading',text:t('الأرصدة الحالية')},{kind:'table',rows:[[t('الحساب'),t('الرصيد')+' '+data.currency],...data.currentAccounts.map(a=>[a.name,a.balance])]},{kind:'subheading',text:t('العملاء والموردون')},{kind:'table',rows:[[t('الحساب'),t('لنا')+' '+data.currency,t('علينا')+' '+data.currency],...data.currentParties.map(p=>[p.name,p.receivable,p.payable])]});
 return {language,dir:language==='fr'?'ltr':'rtl',brand:state.branding||'AlKarna',logo:state.brandInfo?.logo||'',branding:state.brandInfo||{},created:new Date().toLocaleDateString(language==='fr'?'fr-MR':'en-GB'),blocks};
}
export function reportWorkbookData(state,data,options={}){
 const language=options.language||'ar',t=v=>translateText(v,language),label=value=>t(options.labels?.[value]||value);
 const sheets=[{name:t('الملخص'),rows:[[t('البيان'),t('القيمة')],[t('المحل'),state.branding],[t('نوع التقرير'),t(data.title)],[t('العملة'),data.currency],[t('الفترة'),data.filters.allTime?t('كل الفترة'):data.filters.from+' — '+data.filters.to],...(data.party?[[t('الحساب'),data.party.name]]:[]),...(data.warnings||[]).map(w=>[t('ملاحظة'),t(w)]),...data.metrics.map(m=>[t(m.label)+(m.format==='money'?' '+data.currency:''),m.value])]},
 {name:t('الحركات'),rows:[data.columns.map(c=>t(c.label)+(c.format==='money'?' '+data.currency:'')),...data.rows.map(row=>data.columns.map(c=>c.key==='kind'?label(row[c.key]):c.key==='type'?t(row.type==='supplier'?'مورد':'عميل'):row[c.key]??''))]}];
 if(data.stockBalances)sheets.push({name:t('المخزون'),rows:[[t('المنتج'),t('الكمية'),t('القيمة')+' '+data.currency],...data.stockBalances.map(r=>[r.product,r.quantity,r.value])]});
 if(data.currentAccounts)sheets.push({name:t('الأرصدة'),rows:[[t('الحساب'),t('الرصيد')+' '+data.currency],...data.currentAccounts.map(a=>[a.name,a.balance])]},{name:t('الأطراف'),rows:[[t('الحساب'),t('لنا'),t('علينا')],...data.currentParties.map(p=>[p.name,p.receivable,p.payable])]});
 return sheets;
}
