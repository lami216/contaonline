// Document details deliberately use their own markup. Register decorators
// and report metric styles must not turn this document into a list of cards.
export function invoiceDocument(state,record,{esc,money,icon,labels,atSource=false}) {
  const r=record,noncash=['stocktransfer','adjustment','offset'].includes(r.kind);
  const outgoing=['purchase','expense','pay','withdraw'].includes(r.kind);
  const account=state.accounts.find(a=>a.id===r.account);
  const otherAccount=state.accounts.find(a=>a.id===r.to);
  const otherParty=state.parties.find(p=>p.id===r.otherParty);
  const label=labels[r.kind]||'مستند';
  const number=r.number||r.kind.toUpperCase()+'-'+r.id;
  const paymentNote=noncash?'عملية غير نقدية':r.due?'كامل المبلغ ملاحظة على الحساب':r.kind==='transfer'?'تحويل بين الحسابات':(['receive','deposit'].includes(r.kind)?'قبض مسجل':['pay','withdraw','expense'].includes(r.kind)?'صرف مسجل':'دفع كامل')+' · '+(account?.name||'');
  const datum=(name,value)=>value!==undefined&&value!==null&&value!==''?`<div class="document-datum"><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`:'';
  const lineHeading=r.kind==='adjustment'?'تفاصيل التصحيح':r.kind==='stocktransfer'?'البضاعة المحوّلة':'بنود الفاتورة';
  const lineBody=(r.lines||[]).map((line,i)=>`<tr><td class="document-line-name"><span class="document-product-label"><span class="document-line-number">${i+1}</span><strong>${esc(line.name)}</strong></span></td><td>${esc(line.qty)}</td><td>${money(line.price,'xs')}</td><td>${money(line.qty*line.price,'xs')}</td></tr>`).join('');
  return `<div class="document-page">
    <article class="invoice-document" aria-label="${esc(label)}">
      <header class="document-heading"><div>${state.brandInfo?.logo?`<img class="document-brand-logo" src="${esc(state.brandInfo.logo)}" alt="">`:""}<p class="document-shop">${esc(state.branding||'الكرنه')}</p><h2>${esc(label)}</h2></div><span class="document-status ${r.voided?'is-void':''}">${r.voided?'ملغاة':noncash?'حركة مسجلة':r.due?'على الحساب':['sale','purchase','expense'].includes(r.kind)?'مدفوعة':'مسجلة'}</span></header>
      <div class="document-reference"><span dir="ltr">${esc(number)}</span><time datetime="${esc(r.date)}">${esc(r.date)} <span dir="ltr">${esc(r.time)}</span></time></div>
      <dl class="document-information">${datum(r.party?'الطرف':'البيان',r.title)}${datum('وسيلة الدفع',noncash?'لا توجد حركة نقدية':r.due?'ملاحظة على الحساب':account?.name||'—')}${datum('المخزن',r.from?null:r.warehouse)}${datum('من مخزن',r.from)}${datum('إلى مخزن',r.toWarehouse)}${datum('إلى حساب',otherAccount?.name)}${datum('الطرف المقابل',otherParty?.name)}${r.kind==='adjustment'&&Number.isFinite(r.newQty)?datum('الرصيد قبل التصحيح',r.newQty-r.lines[0]?.delta)+datum('الرصيد بعد التصحيح',r.newQty):''}</dl>
      ${lineBody?`<section class="document-items"><h3>${lineHeading}</h3><div class="document-lines-frame"><table class="document-lines" aria-label="${lineHeading}"><colgroup><col style="width:43%"><col style="width:13%"><col style="width:21%"><col style="width:23%"></colgroup><thead><tr><th scope="col">المنتج</th><th scope="col">الكمية</th><th scope="col">سعر الوحدة</th><th scope="col">المجموع</th></tr></thead><tbody>${lineBody}</tbody></table></div></section>`:''}
      ${r.note?`<div class="document-note"><strong>ملاحظات</strong><p>${esc(r.note)}</p></div>`:''}
      <footer class="document-total"><div><span>${noncash?'قيمة العملية':'الإجمالي'}</span><small>${r.voided?'أُلغي أثر هذا المستند':esc(paymentNote)}</small></div>${money(r.total,'document-total-amount',outgoing?'negative':'positive')}</footer>
    </article>
    <div class="document-actions" role="group" aria-label="إجراءات المستند"><button class="document-print" data-action="site:print">${icon('print')}طباعة / حفظ PDF</button>${r.kind!=='offset'?`${!atSource&&!r.voided?`<button data-action="source-location:${r.id}">${icon('arrow')}الانتقال إلى المصدر</button>`:''}${atSource&&!r.voided?`<button data-action="source:${r.id}">${icon('edit')}${['sale','purchase','expense'].includes(r.kind)?'تعديل الفاتورة':'تعديل العملية'}</button>`:''}`: ""}${!r.voided?`<button class="document-delete" data-action="void:${r.id}">${icon('trash')}حذف العملية</button>`:''}</div>
    <button class="document-history" data-action="explain:document:${r.id}">${icon('activity')}سجل التعديلات <span>${r.revision||0}</span></button>
    ${r.voided?'<p class="document-void-note">أُلغي أثر العملية مع الاحتفاظ بالمستند وسجل تعديلاته.</p>':''}
  </div>`;
}
