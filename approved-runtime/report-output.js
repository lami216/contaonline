import {currencyCode} from './upgrade-state.js';
import {translateText} from './i18n.js';
// Shared report content for the downloaded PDF and the separate print action.
import {recordExportData,localizedRecordTitle} from './record-export.js';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const number=(v,language)=>Number(v||0).toLocaleString(language==='fr'?'fr-FR':'en-US',{maximumFractionDigits:2});
export function invoicePdfModel(state,r,labels,{language='ar'}={}){
 const t=v=>translateText(v,language),currency=currencyCode(state),system=v=>['نقدي','بنكيلي','مصرفي','السداد','أمانتي','بيم','المخزن الرئيسي','مخزن الاحتياط'].includes(v)?t(v):v,account=id=>system(state.accounts.find(a=>a.id===id)?.name||'—'),party=state.parties.find(p=>p.id===r.party),kind=labels[r.kind]||r.kind;
 const blocks=[{kind:'heading',text:t(kind)},{kind:'text',text:(r.number||r.kind.toUpperCase()+'-'+r.id)+' · '+t(r.date)+' '+(r.time||'')}];
 const fields=[[t('الحالة'),t(r.voided?'ملغاة':r.due?'على الحساب':'مسجلة')],...(party?[[t(party.type==='supplier'?'المورد':'العميل'),party.name]]:[[t('البيان'),localizedRecordTitle(r,language)]]),...(r.account?[[t('وسيلة الدفع'),account(r.account)]]:[]),...(r.to?[[t('الحساب المستلم'),account(r.to)]]:[]),...(r.warehouse?[[t('المخزن'),system(r.warehouse)]]:[]),...(r.from?[[t('من مخزن'),system(r.from)],[t('إلى مخزن'),system(r.toWarehouse)]]:[])];
 blocks.push({kind:'table',rows:fields,header:false,widths:[.24,.76]});
 if(r.lines.length){const adjustment=r.kind==='adjustment';blocks.push({kind:'subheading',text:t(adjustment?'تفاصيل التصحيح':'بنود الفاتورة')},{kind:'table',widths:[.46,.12,.20,.22],rows:[[t('المنتج'),t(adjustment?'التغيير':'الكمية'),t('سعر الوحدة')+' '+currency,t('المجموع')+' '+currency],...r.lines.map(l=>[l.name+(l.warehouse?' · '+system(l.warehouse):''),adjustment?l.delta:l.qty,l.price,roundTotal(l.qty*l.price)])]});}
 blocks.push({kind:'table',rows:[[t('الإجمالي')+' '+currency,r.total],...(r.paid!=null?[[t('المدفوع')+' '+currency,r.paid]]:[]),...(r.due!=null?[[t('على الحساب')+' '+currency,r.due]]:[])],header:false,widths:[.60,.40]});if(r.note)blocks.push({kind:'subheading',text:t('الملاحظة')},{kind:'text',text:r.note});
 return {language,dir:language==='fr'?'ltr':'rtl',brand:state.branding||'AlKarna',created:new Date().toLocaleDateString(language==='fr'?'fr-MR':'en-GB'),logo:state.brandInfo?.logo||'',branding:state.brandInfo||{},includeFooter:['sale','purchase'].includes(r.kind),blocks};
}
const roundTotal=n=>Math.round((n+Number.EPSILON)*100)/100;
export function reportModel(state,records,labels,scope='كل الفترة',{language='ar'}={}){const t=value=>translateText(value,language).replace(/MRU/g,currencyCode(state));
 const blocks=[{kind:'heading',text:'سجل الفواتير'},{kind:'text',text:scope},{kind:'text',text:`${records.length} مستندات · العملة MRU`},
  {kind:'table',widths:[.06,.17,.17,.40,.20],rows:[['الرقم','التاريخ','النوع','الطرف / البيان','المبلغ MRU'],...records.map((r,i)=>[i+1,t(r.date),t(labels[r.kind]||r.kind),localizedRecordTitle(r,language),number(r.total,language)])]},
  {kind:'heading',text:'تفاصيل المستندات الكاملة'}];
 records.forEach((r,i)=>{
  const sheets=recordExportData(state,[r],labels,{language}),headers=sheets[0].rows[0],values=sheets[0].rows[1];
  blocks.push({kind:'subheading',text:`${i+1}. ${t(labels[r.kind]||r.kind)} — ${r.number||r.kind.toUpperCase()+'-'+r.id}`});
  const fields=headers.map((h,j)=>[h,values[j]]).filter(([,v])=>v!==''&&v!==undefined&&v!==null);
  const rows=[];for(let j=0;j<fields.length;j+=3)rows.push(fields.slice(j,j+3).flat().concat(Array(Math.max(0,6-fields.slice(j,j+3).flat().length)).fill('')));
  blocks.push({kind:'table',widths:[.17,.16,.17,.16,.17,.17],rows,header:false});
  if(sheets[1].rows.length>1)blocks.push({kind:'table',rows:sheets[1].rows});
 });
 for(const block of blocks){if(block.text)block.text=t(block.text);if(block.rows&&block.header!==false)block.rows[0]=block.rows[0].map(t)}
 return {language,dir:language==='fr'?'ltr':'rtl',brand:state.branding||'AlKarna',logo:state.brandInfo?.logo||'',branding:state.brandInfo||{},created:new Date().toLocaleDateString(language==='fr'?'fr-MR':'en-GB'),blocks};
}
export function reportHtml(model){const t=value=>translateText(value,model.language);return `<div class="export-report" dir="${model.dir||'rtl'}" lang="${model.language||'ar'}"><header><h1>${esc(model.brand)}</h1><span>${esc(t('تاريخ التصدير: {date}').replace('{date}',model.created))}</span></header>${model.blocks.map(b=>b.kind==='table'?`<table>${b.widths?'<colgroup>'+b.widths.map(w=>`<col style="width:${w*100}%">`).join('')+'</colgroup>':''}${b.header===false?'':'<thead><tr>'+b.rows[0].map(v=>`<th>${esc(v)}</th>`).join('')+'</tr></thead>'}<tbody>${b.rows.slice(b.header===false?0:1).map(row=>'<tr>'+row.map(v=>`<td>${esc(typeof v==='boolean'?t(v?'نعم':'لا'):typeof v==='number'?number(v,model.language):v)}</td>`).join('')+'</tr>').join('')}</tbody></table>`:b.kind==='heading'?`<h2>${esc(b.text)}</h2>`:b.kind==='subheading'?`<h3>${esc(b.text)}</h3>`:`<p>${esc(b.text)}</p>`).join('')}</div>`}

// Canvas uses the bundled Arabic font and the browser's shaping engine. Pages
// are bounded and released one by one; the PDF works offline without a printer.
export async function reportPdf(model){const french=model.language==='fr',t=value=>translateText(value,model.language),textX=french?40:754;
 await document.fonts.load('12px Arabic');await document.fonts.ready;
 const W=794,H=1123,M=40,BOTTOM=H-50,images=[];let canvas,ctx,y,pageNumber=0,logo=null;
 const branding=model.branding||{},brandFont=({'tahoma':'Tahoma','arial':'Arial','segoe-ui':'Segoe UI','times-new-roman':'Times New Roman'})[branding.nameFont]|| (french?'Arial':'Arabic');
 if(model.logo&&/^data:image\/(png|jpeg|webp);base64,/.test(model.logo)){logo=new Image();logo.src=model.logo;try{await logo.decode()}catch{logo=null}}
 const font=(size=12,bold=false)=>{ctx.font=`${bold?'700':'400'} ${size}px ${french?'Arial':'Arabic'}, sans-serif`;ctx.direction=french?'ltr':'rtl';ctx.textAlign=french?'left':'right';ctx.fillStyle='#25364a'};
 function wrap(value,width,size=12,bold=false){font(size,bold);const source=String(typeof value==='boolean'?t(value?'نعم':'لا'):typeof value==='number'?number(value,model.language):value??''),out=[];let line='';for(const word of source.split(/\s+/)){const next=line?line+' '+word:word;if(ctx.measureText(next).width<=width){line=next;continue}if(line){out.push(line);line=''}if(ctx.measureText(word).width<=width){line=word;continue}for(const ch of word){if(ctx.measureText(line+ch).width>width&&line){out.push(line);line=''}line+=ch}}out.push(line);return out}
 function newPage(){canvas=document.createElement('canvas');canvas.width=W*1.5;canvas.height=H*1.5;ctx=canvas.getContext('2d');ctx.scale(1.5,1.5);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  const logoWidth=logo?52:0;if(logo){const scale=Math.min(46/logo.width,46/logo.height);ctx.drawImage(logo,french?M:W-M-46,15,logo.width*scale,logo.height*scale)}
  font(16,true);ctx.font=`${[400,600,800].includes(branding.nameFontWeight)?branding.nameFontWeight:800} ${Math.min(32,Math.max(16,Number(branding.nameFontSize)||24))}px "${brandFont}",sans-serif`;ctx.fillText(model.brand,textX+(french?logoWidth:-logoWidth),38,W-2*M-logoWidth-210);
  font(10);ctx.fillText(t('تاريخ التصدير: {date}').replace('{date}',model.created),french?W-250:250,35);
  const details=[branding.address,branding.phone,branding.registrationNumber?t('رقم السجل التجاري')+': '+branding.registrationNumber:'',branding.taxNumber?t('الرقم الضريبي')+': '+branding.taxNumber:''].filter(Boolean).join(' · ');
  if(details)ctx.fillText(details,textX,65,W-2*M);const line=details?78:60;ctx.strokeStyle='#9baabd';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(M,line);ctx.lineTo(W-M,line);ctx.stroke();y=line+20;pageNumber++}
 async function finish(){font(10);ctx.fillText(t('صفحة {number}').replace('{number}',pageNumber),textX,H-25);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));if(!blob)throw new Error('تعذر تجهيز صفحة PDF');images.push(new Uint8Array(await blob.arrayBuffer()));canvas.width=canvas.height=0;await new Promise(resolve=>setTimeout(resolve,0))}
 async function ensure(height){if(y+height>BOTTOM){await finish();newPage();return true}return false}
 function drawRow(cells,widths,header=false,offset=0,count){let x=french?M:W-M;const lineHeight=15,h=8+(count??Math.max(1,...cells.map(c=>c.length)))*lineHeight;ctx.fillStyle=header?'#e0e8f2':'#ffffff';ctx.fillRect(M,y,W-2*M,h);ctx.strokeStyle='#b4bfce';ctx.lineWidth=.7;for(let i=0;i<cells.length;i++){const width=widths[i]*(W-2*M);ctx.strokeRect(french?x:x-width,y,width,h);font(header?10:11,header);cells[i].slice(offset,count===undefined?undefined:offset+count).forEach((line,j)=>ctx.fillText(line,french?x+7:x-7,y+17+j*lineHeight));x+=french?width:-width}y+=h;return h}
 newPage();
 for(const block of model.blocks){
  if(block.kind!=='table'){const size=block.kind==='heading'?19:block.kind==='subheading'?13:11,bold=['heading','subheading'].includes(block.kind);const lines=wrap(block.text,W-2*M,size,bold);await ensure(lines.length*(size+6)+14);font(size,bold);for(const line of lines){ctx.fillText(line,textX,y+size);y+=size+6}y+=8;continue}
  if(!block.rows.length)continue;
  const widths=block.widths||Array(block.rows[0].length).fill(1/block.rows[0].length),header=block.header!==false,headerCells=header?block.rows[0].map((v,i)=>wrap(v,widths[i]*(W-2*M)-14,10,true)):null;
  const headHeight=header?8+Math.max(...headerCells.map(c=>c.length))*15:0;
  await ensure(headHeight+45);if(header)drawRow(headerCells,widths,true);
  for(const row of block.rows.slice(header?1:0)){
   const cells=row.map((v,i)=>wrap(v,widths[i]*(W-2*M)-14,11)),lineCount=Math.max(1,...cells.map(c=>c.length));let offset=0;
   while(offset<lineCount){let capacity=Math.floor((BOTTOM-y-8)/15);if(capacity<1||offset===0&&lineCount<=50&&lineCount>capacity){await finish();newPage();if(header)drawRow(headerCells,widths,true);capacity=Math.floor((BOTTOM-y-8)/15)}const count=Math.min(capacity,lineCount-offset);drawRow(cells,widths,false,offset,count);offset+=count}
  }y+=12;
 }if(model.includeFooter&&branding.footer){await ensure(40);font(10);for(const line of wrap(branding.footer,W-2*M,10)){ctx.fillText(line,textX,y+14);y+=15}}await finish();return imagePdf(images,canvas?W*1.5:1191,H*1.5);
}
function imagePdf(images,pixelWidth,pixelHeight){
 pixelWidth=Math.floor(pixelWidth);pixelHeight=Math.floor(pixelHeight);
 const encoder=new TextEncoder(),parts=[],offsets=[0];let length=0;
 const append=value=>{const bytes=typeof value==='string'?encoder.encode(value):value;parts.push(bytes);length+=bytes.length};
 const object=(id,body)=>{offsets[id]=length;append(id+' 0 obj\n');append(body);append('\nendobj\n')};
 append('%PDF-1.4\n');object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
 images.forEach((bytes,i)=>{const id=3+i*3;object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /PageImage ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);offsets[id+1]=length;append(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(pixelWidth)} /Height ${Math.round(pixelHeight)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);append(bytes);append('\nendstream\nendobj\n');const stream='q 595.28 0 0 841.89 0 0 cm /PageImage Do Q';object(id+2,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)});
 const xref=length;append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);for(let i=1;i<offsets.length;i++)append(String(offsets[i]).padStart(10,'0')+' 00000 n \n');append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);return new Blob(parts,{type:'application/pdf'});
}
