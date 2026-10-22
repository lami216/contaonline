import {sqliteBackup,mergeImport} from './import-domain.js';
import {upgradeState} from './upgrade-state.js';
import {seedStockEvents} from './stock-domain.js';
const prepareFeatureState=state=>{upgradeState(state);seedStockEvents(state)};
import {validateState} from './database.js';
export function installImportFeatures(api){
 let stage=null,preview=null,progress='',afterCommit=false;
 const oldUtility=utility;utility=function(){return oldUtility()+(view==='backup'?section('دمج بيانات سابقة')+listMenu([['استيراد ودمج البيانات','JSON أو SQLite أو DB · معاينة ومطابقة قبل الحفظ','box','site:feature:import'],['متابعة استيراد محفوظ','استكمال المعاينة دون تكرار العمليات','receipt','site:feature:import-resume']]):'')};
 const options=()=>({...stage?.options,...api.form()}),build=()=>{preview=mergeImport(S,stage.incoming,stage.options);return preview};
 const save=async()=>api.database.put('meta',{id:'feature-import-pending',stage,at:new Date().toISOString()});
 const select=(name,label)=>field(label,`<select name="${name}"><option value="current" ${stage.options[name]!=='imported'?'selected':''}>الإبقاء على الحالي</option><option value="imported" ${stage.options[name]==='imported'?'selected':''}>اعتماد المستورد</option></select>`);
 return {
  sheet(){
   if(modal==='feature-import')return api.modalMarkup('استيراد ودمج البيانات',`<label class="backup-file-picker"><span>اختر ملف البيانات</span><small>JSON · SQLite · DB</small><input type="file" id="feature-import-file" accept=".json,.sqlite,.sqlite3,.db"></label><p class="notice">لن تتغير البيانات قبل المعاينة والتأكيد. حسابات الدخول والتفعيل تبقى كما هي.</p>`,'site:feature:import-review','مراجعة الملف','feature-sheet');
   if(modal==='feature-import-progress')return api.modalMarkup('مراجعة الملف',`<p class="notice" role="status">${esc(progress)}</p>`,'','حفظ','feature-sheet');
   if(modal==='feature-import-preview'&&stage&&preview){const labels={products:'المنتجات',parties:'العملاء والموردون',accounts:'وسائل الدفع',warehouses:'المخازن',categories:'الفئات',records:'المستندات',existing:'الموجود مسبقًا'};
    return api.modalMarkup('معاينة الدمج',`<div class="feature-scope"><strong data-user-content>${esc(stage.filename)}</strong><small>${esc(stage.fingerprint.slice(0,16))}</small></div><div class="feature-import-counts">${Object.entries(preview.counts).map(([k,v])=>`<div><span>${labels[k]}</span><b>${v}</b></div>`).join('')}</div><details class="feature-details"><summary>سياسة التعارضات</summary><div class="feature-fields">${select('stocks','أرصدة المنتجات المتطابقة')}${select('accounts','أرصدة وسائل الدفع المتطابقة')}${select('parties','أرصدة الأطراف المتطابقة')}${select('records','المستندات الموجودة مسبقًا')}</div><button class="feature-button" data-action="site:feature:import-options">تحديث المعاينة</button></details>${preview.conflicts.map((c,i)=>field(c.name,`<select name="match-${i}"><option value="">اختر المطابقة</option><option value="new">إنشاء مستقل</option>${c.candidates.map(x=>`<option value="${x.id}">${esc(x.name)} · ${x.id}</option>`).join('')}</select>`)).join('')}${preview.conflicts.length?'<button class="feature-button" data-action="site:feature:import-match">تأكيد المطابقات</button>':''}${[...stage.warnings,...preview.warnings].length?`<details class="feature-details"><summary>ملاحظات الاستيراد</summary>${[...stage.warnings,...preview.warnings].map(w=>`<p class="notice">${esc(w)}</p>`).join('')}</details>`:''}<p class="notice">يُحفظ احتياطي كامل قبل الدمج. تظل الأرصدة الحالية للكيانات المتطابقة وفق السياسة المختارة، مع حفظ رصيد بداية يفسّر الحركات المستوردة.</p>` ,preview.conflicts.length?'':'site:feature:import-commit','تأكيد الدمج','feature-sheet');
   }
   return null;
  },
  handles:command=>command==='import'||command.startsWith('import-'),permission:()=> 'settings.legacy.import',
  async action(command){
   if(command==='import'){stage=null;preview=null;modal='feature-import';return render()}
   if(command==='import-resume'){const saved=await api.database.get('meta','feature-import-pending');if(!saved?.stage)throw Error('لا يوجد استيراد محفوظ');stage=saved.stage;build();modal='feature-import-preview';return render()}
   if(command==='import-review'){
    const file=document.querySelector('#feature-import-file')?.files?.[0];if(!file)throw Error('اختر ملف البيانات');if(file.size>40*1024*1024)throw Error('الملف أكبر من 40 ميغابايت');const bytes=new Uint8Array(await file.arrayBuffer()),fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    progress='جارٍ قراءة الملف…';modal='feature-import-progress';render();await new Promise(r=>setTimeout(r,0));
    let raw;if(new TextDecoder().decode(bytes.slice(0,15))==='SQLite format 3')raw=await sqliteBackup(bytes,(phase,count)=>{progress=phase+' · '+count;const status=document.querySelector('[role=status]');if(status)status.textContent=progress});else{try{raw=JSON.parse(new TextDecoder().decode(bytes))}catch{throw Error('صيغة الملف غير مدعومة')}}
    let incoming;if(raw.format==='alkarna-web-backup'&&raw.schemaVersion===1)incoming=raw.state;else if(raw.format==='conta-backup'&&raw.schemaVersion===1)incoming=api.desktopToState(raw);else throw Error('صيغة الملف غير مدعومة');const sameOwner=[...(incoming.users||[]),...(raw.users||[])].some(u=>u.role==='owner'&&api.users.some(current=>current.role==='owner'&&current.id===u.id));incoming.originId??=sameOwner?S.originId:'import:'+fingerprint;prepareFeatureState(incoming);validateState(incoming);
    stage={filename:file.name,fingerprint,incoming,options:{stocks:'current',accounts:'current',parties:'current',records:'current',matches:{}},warnings:raw.warnings||[]};build();await save();modal='feature-import-preview';return render();
   }
   if(command==='import-options'){stage.options={...options(),matches:stage.options.matches};build();await save();return render()}
   if(command==='import-match'){const values=api.form();for(let i=0;i<preview.conflicts.length;i++){const value=values['match-'+i];if(!value)throw Error('اختر مطابقة لكل عنصر');stage.options.matches[preview.conflicts[i].key]=value;}build();await save();return render()}
   if(command==='import-commit'){
    if(!stage)throw Error('راجع الملف أولًا');build();if(preview.conflicts.length)throw Error('عالج المطابقات قبل الحفظ');validateState(preview.state);
    await api.database.put('meta',{id:'safety-backup',backup:{state:api.stateForSave(),users:await api.database.all('users')},savedAt:new Date().toISOString()});
    const next=preview.state;next.importRuns??=[];next.importRuns.push({fingerprint:stage.fingerprint,filename:stage.filename,counts:preview.counts,completedAt:new Date().toISOString()});S=next;syncStock();afterCommit=true;modal=null;view='backup';render();return;
   }
  },
  async afterSave(){if(afterCommit){afterCommit=false;await api.database.put('meta',{id:'feature-import-pending',stage:null});stage=null;preview=null;toast('تم دمج البيانات وحفظ نسخة أمان')}}
 };
}
