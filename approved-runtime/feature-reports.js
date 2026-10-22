import {reportDataset,reportOutputModel,reportWorkbookData,reportTitles} from './report-data.js';
import {currencyCode} from './upgrade-state.js';
import {reportPdf,reportModel,invoicePdfModel} from './report-output.js';
import {recordExportData,recordWorkbook} from './record-export.js';
import {appLanguage,formatNumber,translateText} from './i18n.js';

export function installReportFeatures(api){
 const scoped={},original=reports;let openedMetric=null;
 const periodFilter=()=>({allTime:period==='all',from:period==='today'?api.today():dateFrom,to:period==='today'?api.today():dateTo});
 const filters=()=>{const f={...scoped[reportType]};for(const [key,list]of [['categoryId',S.categories||[]],['productId',S.products],['partyId',S.parties],['accountId',S.accounts]])if(f[key]&&!list.some(x=>x.id===Number(f[key])))f[key]='';return {...f,...periodFilter(),type:reportType}};
 const dataset=()=>reportDataset(S,filters());
 const active=()=>Object.values(scoped[reportType]||{}).some(v=>v!==''&&v!==null&&v!==false);
 function table(data,sourceRows=data.rows){
  const keys=data.currentStock?['product','quantity','value']:data.trace?['date','party','contribution']:data.type==='party-ledger'?['date','number','change','balance']:data.type==='stock'?['product','kind','delta','after']:data.type==='financial'?['account','date','incoming','outgoing','balance']:data.type==='product-sales'?['product','quantity','total','profit']:data.type==='debts'?['party','receivable','payable']:['date','party','total','due'];
  const cols=keys.map(k=>data.columns.find(c=>c.key===k)).filter(Boolean),cell=(row,c)=>row[c.key]===null?'—':c.format==='money'?money(row[c.key],'xs',row[c.key]<0?'negative':''):c.key==='kind'?esc(documentLabels[row[c.key]]||row[c.key]):esc(row[c.key]??'—');
  return reportSourceTable31(data.title,cols.map(c=>c.label),sourceRows,row=>({action:row.action,cells:cols.map(c=>cell(row,c)+(c.key==='number'&&row.kind?`<small>${esc(documentLabels[row.kind]||row.kind)}</small>`:''))})).replace('report-source-table','report-source-table feature-report-table');
 }
 const filterButton=()=>`<button class="feature-filter-button" type="button" data-action="site:feature:report-filters">${icon('settings')}تصفية التقرير${active()?'<span class="dot"></span>':''}</button>`;
 reports=function(){
  if(['overview','sales','purchases','expenses','profit'].includes(reportType)&&!active())return original().replace('</div>',filterButton()+'</div>');
  const data=dataset();return `${(data.warnings||[]).map(w=>`<p class="notice">${esc(w)}</p>`).join('')}<div class="browse-toolbar">${browseButton('report',browseReports[reportType],'نوع التقرير')}${browseButton('period',browsePeriod(),'الفترة')}${filterButton()}</div>${data.party?`<div class="feature-scope"><strong data-user-content>${esc(data.party.name)}</strong><small>${period==='all'?'كل الفترة':esc(filters().from+' — '+filters().to)}</small></div>`:''}${data.needsParty?`<div class="empty"><h3>اختر الحساب</h3><p>اختر عميلًا أو موردًا لعرض كشف حسابه.</p><button class="primary" data-action="site:feature:report-filters">اختيار الحساب</button></div>`:`${section('ملخص الفترة')}<div class="metric-grid report-metrics-31">${data.metrics.map((m,i)=>`<button class="metric-card inline-metric" data-action="site:feature:report-metric:${i}"><strong>${esc(m.label)}</strong>${m.format==='money'?money(m.value,'sm'): `<b class="metric-count">${formatNumber(m.value)}</b>`}</button>`).join('')}</div>${section('تفاصيل التقرير')}${table(data)}`}`;
 };
 function fields(){
  const f=filters(),opt=(name,list,value,placeholder)=>field(name,`<select name="${value}"><option value="">${placeholder}</option>${list.map(x=>`<option value="${x.id}" ${String(x.id)===String(f[value])?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`);
  let html='';if(['sales','purchases','product-sales','stock','profit'].includes(reportType)){html+=opt('الفئة',S.categories||[],'categoryId','كل الفئات');html+=opt('المنتج',S.products.filter(p=>!f.categoryId||p.categoryId===Number(f.categoryId)),'productId','كل المنتجات');}
  if(['sales','purchases','expenses','financial'].includes(reportType))html+=opt('وسيلة الدفع',S.accounts,'accountId','كل وسائل الدفع');
  if(['stock','sales','purchases'].includes(reportType))html+=field('المخزن',`<select name="warehouse"><option value="">كل المخازن</option>${S.warehouses.map(w=>`<option ${w===f.warehouse?'selected':''}>${esc(w)}</option>`).join('')}</select>`);
  if(['party-ledger','debts'].includes(reportType)){
   html+=field('نوع الحساب',`<select name="partyType" data-feature-change="report-party-type"><option value="customer" ${f.partyType!=='supplier'?'selected':''}>عميل</option><option value="supplier" ${f.partyType==='supplier'?'selected':''}>مورد</option>${reportType==='debts'?`<option value="" ${f.partyType===''?'selected':''}>الكل</option>`:''}</select>`);
   html+=opt('الحساب',S.parties.filter(p=>!f.partyType||p.type===f.partyType),'partyId','اختر الحساب');
  }
  if(reportType==='financial')html+=field('الاتجاه',`<select name="direction"><option value="">داخل وخارج</option><option value="in" ${f.direction==='in'?'selected':''}>داخل</option><option value="out" ${f.direction==='out'?'selected':''}>خارج</option></select>`);
  if(reportType==='debts')html+=field('الرصيد',`<select name="debtSide">${[['','الكل'],['receivable','لنا عليه'],['payable','له علينا'],['clear','حساب خالص']].map(([v,t])=>`<option value="${v}" ${f.debtSide===v?'selected':''}>${t}</option>`).join('')}</select>`)+field('بحث بالاسم أو الهاتف',input('search','text',f.search||''));
  if(reportType==='stock')html+=field('نوع الحركة',`<select name="movementType">${[['','كل الحركات'],['sale','المبيعات'],['purchase','المشتريات'],['stocktransfer','تحويل مخزون'],['adjustment','تصحيح مخزون']].map(([v,t])=>`<option value="${v}" ${f.movementType===v?'selected':''}>${t}</option>`).join('')}</select>`);
  return html||'<p class="notice">الفترة تحدد النتائج المعروضة والمصدرة.</p>';
 }
 async function output(format,individual=false){
  const language=appLanguage(),options={language,labels:documentLabels};let model,sheets,name;
  if(individual){const r=S.records.find(r=>r.id===selected);if(!r)throw Error('المستند غير موجود');model=invoicePdfModel(S,r,documentLabels,{language});sheets=recordExportData(S,[r],documentLabels,{language});name='alkarna-'+r.kind+'-'+r.id;model.logo=S.brandInfo?.logo||'';model.branding=S.brandInfo||{};}
  else if(view==='reports'){
   const data=dataset();if(data.needsParty)throw Error('اختر الحساب');model=reportOutputModel(S,data,options);sheets=reportWorkbookData(S,data,options);name='alkarna-'+reportType+'-'+api.today();
  }else{const rows=api.exportRecords();if(!rows.length)throw Error('لا توجد مستندات ضمن الفلاتر المختارة');model=reportModel(S,rows,documentLabels,api.exportScope(),{language});sheets=recordExportData(S,rows,documentLabels,{language});name='alkarna-records-'+api.today();}
  if(format==='pdf')await api.offerExport(name+'.pdf',await reportPdf(model));else await api.offerExport(name+'.xlsx',recordWorkbook(sheets,{language}));
 }
 return {
  filters,dataset,output,
  sheet(){if(modal==='feature-report-filters')return api.modalMarkup('تصفية التقرير',`<div class="feature-fields">${fields()}</div><button type="button" class="feature-reset" data-action="site:feature:report-reset">إزالة الفلاتر</button>`,'site:feature:report-apply','عرض التقرير','feature-sheet');
   if(modal==='feature-report-metric'){const d=dataset(),m=d.metrics[openedMetric];
    let formula='',trace=d;const metricBase=m.label.replace(/ المثبتة?$/,'');
    if(d.type==='stock'&&['قيمة المخزون','الوحدات','عدد المنتجات'].includes(m.label)){formula='قيمة المخزون = الرصيد الحالي لكل منتج × تكلفته الحالية.';trace={...d,currentStock:true,columns:[{key:'product',label:'المنتج'},{key:'quantity',label:'الرصيد الحالي',format:'number'},{key:'value',label:'القيمة',format:'money'}],rows:d.stockBalances};}
    if(d.type==='stock'&&['الداخل','الخارج'].includes(m.label))trace={...d,rows:d.rows.filter(r=>m.label==='الداخل'?r.delta>0:r.delta<0)};
    const tradeMetric={'المبيعات':['sale','total'],'تكلفة البيع':['sale','cost'],'الربح الإجمالي':['sale','profit'],'المشتريات':['purchase','total'],'المصاريف':['expense','total'],'المدفوع عند البيع':['sale','paid'],'الآجل عند البيع':['sale','due'],'المدفوع عند الشراء':['purchase','paid'],'الآجل عند الشراء':['purchase','due']};
    if(metricBase==='صافي الربح'||tradeMetric[metricBase]){const definition=tradeMetric[metricBase];formula=metricBase==='صافي الربح'?'صافي الربح = المبيعات − تكلفة البيع − المصاريف.':metricBase==='الربح الإجمالي'?'الربح الإجمالي = المبيعات − تكلفة البيع.':'مجموع الحركات المطابقة للفلاتر.';trace={...d,trace:true,columns:[{key:'date',label:'التاريخ'},{key:'party',label:'الطرف / البيان'},{key:'contribution',label:'القيمة',format:'money'}],rows:d.rows.filter(r=>definition?r.kind===definition[0]:['sale','expense'].includes(r.kind)).map(r=>({...r,contribution:definition?r[definition[1]]:r.kind==='sale'?r.profit:-r.total}))};}
    return api.modalMarkup(m.label,`<p class="notice">${esc(d.title)} · ${d.party?esc(d.party.name):period==='all'?'كل الفترة':esc(filters().from+' — '+filters().to)}</p>${formula?`<p class="report-context-note">${formula}</p>`:''}<div class="report-trace-total">${m.format==='money'?money(m.value,'sm'):formatNumber(m.value)}</div>${table(trace)}`,'','حفظ','feature-sheet');}
   if(modal==='feature-document-output')return api.modalMarkup('تصدير الفاتورة','<div class="export-output-options"><button data-action="site:feature:document-pdf"><span class="output-file-badge pdf">PDF</span><span><strong>ملف PDF</strong><small>تنزيل الفاتورة كاملة</small></span></button><button data-action="site:feature:document-excel"><span class="output-file-badge excel">XLSX</span><span><strong>ملف إكسل</strong><small>البيانات وبنود الفاتورة</small></span></button></div>');
   return null;},
  async action(command,id){
   if(command==='report-filters'){modal='feature-report-filters';return render()}
   if(command==='report-reset'){scoped[reportType]={};modal=null;return render()}
   if(command==='report-party-type'){scoped[reportType]={...scoped[reportType],...api.form(),partyType:id,partyId:''};return render()}
   if(command==='report-apply'){const next={...api.form()};reportDataset(S,{...next,...periodFilter(),type:reportType});scoped[reportType]=next;modal=null;return render()}
   if(command==='report-metric'){openedMetric=Number(id);if(dataset().metrics[openedMetric]?.label==='صافي العملاء'){sourceKey='audit:customer-net';modal='sourceinfo';return render()}modal='feature-report-metric';return render()}
   if(command==='party-statement'){if(!api.can('reports.view'))throw Error('غير متاح بصلاحيات حسابك');const p=S.parties.find(p=>p.id===Number(id));if(!p)throw Error('الحساب غير موجود');reportType='party-ledger';scoped[reportType]={partyId:p.id,partyType:p.type};go('reports');return}
   if(command==='document-output'){modal='feature-document-output';return render()}
   if(command==='document-pdf')return output('pdf',true);if(command==='document-excel')return output('excel',true);
  },
  handles:command=>/^(report-|party-statement|document-)/.test(command),
  permission(command,id){if(command.startsWith('document-')){const r=S.records.find(r=>r.id===selected);return r?.kind==='sale'?'pos.view':r?.kind==='purchase'?'purchases.view':'records.view';}if(command==='party-statement'){const p=S.parties.find(p=>p.id===Number(id));return p?.type==='supplier'?'suppliers.view':'customers.view';}return 'reports.view';}
 };
}
