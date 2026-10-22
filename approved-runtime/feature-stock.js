import {activeWarehouses} from './upgrade-state.js';
import {openingState,planOpeningRecord,stockOperationRecord} from './stock-domain.js';

export function installStockFeatures(api){
 let draft=null,signature='',lineId=null,opening=null,openingProduct=0,pendingNavigation=null,passNavigation=false,expenseDraft=null,removeAfterSave=null;
 const key=kind=>'alkarna-workflow-draft:'+api.actor?.id+':'+kind;
 const read=kind=>{try{return JSON.parse(localStorage.getItem(key(kind))||'null')}catch{return null}};
 const store=kind=>{if(editingId)return;try{localStorage.setItem(key(kind),JSON.stringify(kind==='expense'?expenseDraft:draft))}catch{throw Error('تعذّر حفظ المسودة. أبقِ الصفحة مفتوحة حتى إتمام العملية.')}};
 const remove=kind=>{try{localStorage.removeItem(key(kind))}catch{}};
 function init(){
  const mode=view==='transfer'?'transfer':'adjustment',next=api.actor?.id+':'+mode+':'+(editingId||'new');if(signature===next&&draft)return draft;
  const record=S.records.find(r=>r.id===editingId),saved=record?null:read(mode),warehouses=activeWarehouses(S);
  draft=record?{from:record.from||record.warehouse,to:record.toWarehouse||'',note:record.note||'',lines:record.lines.map(l=>({product:l.product,quantity:mode==='transfer'?l.qty:l.actualQuantity??(S.products.find(p=>p.id===l.product)?.stocks[record.warehouse]||0)}))}:saved||{from:warehouses.includes(S.warehouse)?S.warehouse:warehouses[0],to:warehouses.find(w=>w!==S.warehouse)||'',note:'',lines:[]};
  draft.lines=draft.lines.filter(l=>S.products.some(p=>p.id===l.product&&!p.archived));signature=next;return draft;
 }
 const select=(name,value,list)=>`<select name="${name}" data-feature-stock-field>${list.map(x=>`<option value="${esc(x)}" ${x===value?'selected':''}>${esc(x)}</option>`).join('')}</select>`;
 const oldStock=stockEditor;stockEditor=function(){
  const d=init(),warehouses=activeWarehouses(S),mode=view==='transfer'?'transfer':'adjustment';
  return `<div class="feature-stock-editor">${editingId?`<p class="notice">تعديل العملية · ${S.records.find(r=>r.id===editingId)?.number||editingId}</p>`:''}<form id="utility-form"><div class="pair">${field(mode==='transfer'?'من مخزن':'المخزن',select('from',d.from,warehouses))}${mode==='transfer'?field('إلى مخزن',select('to',d.to,warehouses.filter(w=>w!==d.from))):''}</div><div class="feature-stock-add">${field('المنتج',`<select name="product"><option value="">اختر المنتج</option>${S.products.filter(p=>!p.archived).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>`)}<button type="button" class="feature-button" data-action="site:feature:stock-add">${icon('plus')}إضافة</button></div>${api.boundedTableHtml(`<div class="register-table-shell"><div class="register-scroll"><table class="register-table feature-stock-lines"><thead><tr><th>المنتج</th><th>المتوفر</th><th>${mode==='transfer'?'الكمية':'العدد الفعلي'}</th><th></th></tr></thead><tbody>${d.lines.map(l=>{const p=S.products.find(p=>p.id===l.product);return `<tr><td><button class="feature-row-name" type="button" data-action="site:feature:stock-line:${l.product}">${esc(p.name)}</button></td><td>${p.stocks[d.from]||0}</td><td><button class="feature-row-number" type="button" data-action="site:feature:stock-line:${l.product}">${l.quantity}</button></td><td><button class="icon-btn negative" type="button" data-action="site:feature:stock-remove:${l.product}" aria-label="إزالة ${esc(p.name)}">${icon('close')}</button></td></tr>`}).join('')||'<tr><td colspan="4">أضف منتجات إلى العملية</td></tr>'}</tbody></table></div></div>`)}${field(mode==='transfer'?'ملاحظة':'سبب التصحيح',`<input name="note" maxlength="300" data-feature-stock-field value="${esc(d.note)}">`)}</form>${!editingId&&d.lines.length?`<p class="feature-draft-note">المسودة محفوظة على هذا الجهاز</p>`:''}${section('سجل هذه العمليات')}${rows(liveRecords().filter(r=>r.kind===(mode==='transfer'?'stocktransfer':'adjustment')))}</div>`;
 };
 document.addEventListener('input',event=>{if(event.target.matches('[data-feature-stock-field]')){const d=init();d[event.target.name]=event.target.value;store(view==='transfer'?'transfer':'adjustment')}if(modal==='expense'&&event.target.closest('#sheet-form')){expenseDraft={...expenseDraft,...api.form()};store('expense')}});
 document.addEventListener('change',event=>{if(event.target.matches('select[data-feature-stock-field]')){const d=init();d[event.target.name]=event.target.value;if(d.from===d.to)d.to=activeWarehouses(S).find(w=>w!==d.from)||'';store(view==='transfer'?'transfer':'adjustment');render()}});
 return {
  afterSave(){if(removeAfterSave){remove(removeAfterSave);removeAfterSave=null;}},
  async before(action){
   if(action==='open:expense'){expenseDraft=read('expense')||{date:api.today()};}
   if(action==='post-cash'&&modal==='expense'){expenseDraft={...expenseDraft,...api.form()};const date=expenseDraft.date;let valid=false;try{valid=/^\d{4}-\d{2}-\d{2}$/.test(date)&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date}catch{}if(!valid)throw Error('التاريخ غير صالح');}
   if(action==='review-utility'&&['transfer','adjustment'].includes(view)){
    const d=init(),f=api.form('utility-form');d.from=f.from||d.from;d.to=f.to||d.to;d.note=f.note||'';
    const old=S.records.find(r=>r.id===editingId),kind=view==='transfer'?'stocktransfer':'adjustment',base=newRecord(kind);
    pendingRecord=stockOperationRecord(S,view,d,old,base.id,base.date,base.time);modal='feature-stock-review';render();return true;
   }
   if(!passNavigation&&['transfer','adjustment'].includes(view)&&draft?.lines.length&&/^(go:|back$|invoice:|new:)/.test(action)){
    pendingNavigation=action;modal='feature-draft-leave';render();return true;
   }
   passNavigation=false;return false;
  },
  after(action,oldView,oldModal,oldEditing){
   if(action==='post-cash'&&oldModal==='expense'&&view==='invoice'){removeAfterSave='expense';expenseDraft=null;}
   if((action==='commit-pending'||action==='site:feature:stock-confirm')&&view==='invoice'&&['transfer','adjustment'].includes(oldView)){removeAfterSave=oldView;draft=null;signature='';}
   if(action.startsWith('source:')){signature='';draft=null;const r=S.records.find(r=>r.id===Number(action.split(':')[1]));if(r?.kind==='expense')expenseDraft={name:r.title,account:String(r.account),amount:String(r.total),note:r.note||'',date:r.date};render();}
  },
  date(){return modal==='expense'?expenseDraft?.date:null;},
  restoreInputs(){if(modal==='expense'&&expenseDraft)for(const [name,value]of Object.entries(expenseDraft)){const input=document.querySelector('#sheet-form [name='+name+']');if(input&&document.activeElement!==input)input.value=value??'';}},
  sheet(){
   if(modal==='feature-stock-line'){const p=S.products.find(p=>p.id===lineId),l=draft.lines.find(l=>l.product===lineId);return api.modalMarkup('تعديل الكمية',`<h3 data-user-content>${esc(p.name)}</h3>${field(view==='transfer'?'الكمية المنقولة':'العدد الفعلي',`<input name="quantity" type="text" inputmode="decimal" data-pos-select-all value="${esc(l.quantity)}">`)}`,'site:feature:stock-line-save','حفظ','feature-sheet');}
   if(modal==='feature-stock-review')return api.modalMarkup('مراجعة العملية',`<p class="notice">${esc(pendingRecord.from||pendingRecord.warehouse)}${pendingRecord.toWarehouse?' ← '+esc(pendingRecord.toWarehouse):''}</p><div class="feature-admin-list">${pendingRecord.lines.map(l=>`<div class="feature-admin-row"><strong data-user-content>${esc(l.name)}</strong><span>${pendingRecord.kind==='stocktransfer'?l.qty:l.actualQuantity}</span></div>`).join('')}</div>`,'site:feature:stock-confirm','تأكيد التسجيل','feature-sheet');
   if(modal==='feature-opening'&&(S.products.find(p=>p.id===openingProduct)?.openingHistoryLocked||!opening.hasNativeOpening&&opening.hasStockHistory))return api.modalMarkup('رصيد البداية',`<h3 data-user-content>${esc(S.products.find(p=>p.id===openingProduct)?.name)}</h3><p class="notice">رصيد البداية التاريخي غير قابل للتعديل؛ راجع سجل الحركات</p>${section('سجل رصيد البداية')}${rows(S.records.filter(r=>r.lines.some(l=>l.product===openingProduct)))}`,'','حفظ','feature-sheet');
   if(modal==='feature-opening')return api.modalMarkup('رصيد البداية',`<h3 data-user-content>${esc(S.products.find(p=>p.id===openingProduct)?.name)}</h3><div class="feature-opening-metrics"><span>الأصل <b>${opening.total}</b></span><span>المستهلك <b>${opening.consumed}</b></span><span>المتبقي <b>${opening.remaining}</b></span></div><div class="feature-admin-list">${Object.entries(opening.allocations).map(([w,q])=>`<div class="feature-admin-row"><span data-user-content>${esc(w)}</span><b>${q}</b></div>`).join('')}</div>${field('رصيد البداية الجديد',input('openingTotal','number',opening.total))}${field('تكلفة الوحدة',input('openingCost','number',opening.cost||''))}${field('مخزن رصيد البداية',select('openingWarehouse',opening.warehouseId,activeWarehouses(S)))}<label class="feature-check"><input type="checkbox" name="relocate" value="yes">نقل المتبقي إلى المخزن المحدد</label>${field('سبب التصحيح',input('reason','text'))}${!opening.hasNativeOpening&&opening.hasStockHistory||S.products.find(p=>p.id===openingProduct)?.openingHistoryLocked?'<p class="notice">رصيد البداية التاريخي غير قابل للتعديل؛ راجع سجل الحركات</p>':''}${section('سجل رصيد البداية')}<div class="feature-admin-list">${S.records.filter(r=>(r.openingStock||r.openingCorrection)&&r.lines.some(l=>l.product===openingProduct)||r.openingProduct===openingProduct).map(r=>`<button class="feature-admin-row" data-action="invoice:${r.id}"><span>${esc(r.date)} · ${r.openingCorrection?'تصحيح رصيد البداية':'رصيد البداية'}</span><small>${r.voided?'ملغاة':'التفاصيل'}</small></button>`).join('')}</div>`,'site:feature:opening-save','تسجيل التصحيح','feature-sheet');
   if(modal==='feature-draft-leave')return api.modalMarkup('مغادرة العملية',`<p class="notice">يمكنك العودة للمسودة لاحقًا.</p><div class="feature-action-pair"><button class="feature-button" data-action="site:feature:draft-continue">متابعة التعديل</button><button class="feature-button" data-action="site:feature:draft-leave">حفظ المسودة والخروج</button></div><button class="feature-button negative" data-action="site:feature:draft-discard">حذف المسودة والخروج</button>`);
   return null;
  },
  async action(command,id){
   if(command==='stock-add'){const d=init(),product=Number(api.form('utility-form').product),p=S.products.find(p=>p.id===product);if(!p)throw Error('اختر المنتج');if(!d.lines.some(l=>l.product===product))d.lines.push({product,quantity:view==='transfer'?1:p.stocks[d.from]||0});lineId=product;modal='feature-stock-line';store(view);return render()}
   if(command==='stock-line'){lineId=Number(id);modal='feature-stock-line';return render()}
   if(command==='stock-remove'){init().lines=draft.lines.filter(l=>l.product!==Number(id));store(view);return render()}
   if(command==='stock-line-save'){const value=Number(api.form().quantity);if(!Number.isFinite(value)||value<0||view==='transfer'&&value===0)throw Error('أدخل كمية صحيحة');draft.lines.find(l=>l.product===lineId).quantity=value;modal=null;store(view);return render()}
   if(command==='stock-confirm'){if(!pendingRecord)throw Error('راجع العملية أولًا');const kind=pendingRecord.kind;if(commitRecord(pendingRecord)){removeAfterSave=kind==='stocktransfer'?'transfer':'adjustment';draft=null;signature='';}return}
   if(command==='opening'){openingProduct=Number(id);const p=S.products.find(p=>p.id===openingProduct);if(!p)throw Error('المنتج غير موجود');opening=await openingState(S,p);modal='feature-opening';return render()}
   if(command==='opening-save'){const p=S.products.find(p=>p.id===openingProduct),f=api.form(),base=newRecord('adjustment'),record=planOpeningRecord(S,p,await openingState(S,p),Number(f.openingTotal),Number(f.openingCost),f.openingWarehouse,f.relocate==='yes',base.id,base.date,base.time,f.reason);commitRecord(record);return}
   if(command==='draft-continue'){modal=null;return render()}
   if(command==='draft-leave'||command==='draft-discard'){const next=pendingNavigation;if(command==='draft-discard'){remove(view);draft=null;signature='';}else store(view);pendingNavigation=null;modal=null;passNavigation=true;return api.engineDispatch(next)}
  },
  handles:command=>/^(stock-|opening|draft-)/.test(command),
  permission(command){return command.startsWith('opening')?'warehouses.adjust':(view==='transfer'?'warehouses.transfer':'warehouses.adjust')+(editingId?'.edit':'');},
  expenseHtml(html){return modal==='expense'?html.replace('<div class="cash-form">','<div class="cash-form">'+field('تاريخ المصروف',input('date','date',expenseDraft?.date||api.today()))):html;}
 };
}
