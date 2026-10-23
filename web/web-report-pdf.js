import { translateText } from './i18n.js';
let fonts;
async function fontData() {
  if (fonts) return fonts;
  const names=['StitchArabic.ttf','StitchArabicBold.ttf'];
  fonts = Promise.all(names.map(async name=>{
    const response=await fetch('./assets/'+name);
    if(!response.ok)throw Error('ملف الخط غير متاح');
    const bytes=new Uint8Array(await response.arrayBuffer());
    let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
    return btoa(binary);
  }));
  return fonts;
}
export async function reportPdf(model) {
  const api=globalThis.jspdf;
  if(!api?.jsPDF)throw Error('مولد PDF غير متاح');
  const [regular,bold]=await fontData(), french=model.language==='fr', t=value=>translateText(String(value??''),model.language);
  const doc=new api.jsPDF({unit:'pt',format:'a4',compress:true,putOnlyUsedFonts:true});
  doc.addFileToVFS('StitchArabic.ttf',regular);doc.addFont('StitchArabic.ttf','Arabic','normal');
  doc.addFileToVFS('StitchArabicBold.ttf',bold);doc.addFont('StitchArabicBold.ttf','Arabic','bold');
  doc.setLanguage(french?'fr-FR':'ar-MR');
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=32,BOTTOM=H-42;
  let y=0,page=0;
  const format=value=>typeof value==='number'?value.toLocaleString(french?'fr-FR':'en-US',{maximumFractionDigits:2}):typeof value==='boolean'?t(value?'نعم':'لا'):String(value??'');
  function font(size=10,weight='normal'){doc.setFont('Arabic',weight);doc.setFontSize(size);doc.setTextColor(25,40,60);}
  function text(value,x,baseline,width,size=10,weight='normal'){
    font(size,weight);doc.setR2L(false);
    doc.text(format(value),x,baseline,{align:french?'left':'right',maxWidth:width,isInputVisual:false,isOutputVisual:true,isOutputRtl:false});
  }
  function wrap(value,width,size=10,weight='normal'){font(size,weight);return doc.splitTextToSize(format(value),Math.max(12,width));}
  function footer(){text(t('صفحة {number}').replace('{number}',String(page)),french?M:W-M,H-20,W-2*M,8);}
  function newPage(){if(page){footer();doc.addPage();}page++;y=34;text(model.brand||'AlKarna',french?M:W-M,y,W-2*M,17,'bold');y+=19;
    const branding=model.branding||{},details=[branding.phone,branding.address,branding.registrationNumber,branding.taxNumber].filter(Boolean).join(' · ');
    if(details){for(const line of wrap(details,W-2*M,8)){text(line,french?M:W-M,y,W-2*M,8);y+=12;}}
    text(model.created||'',french?M:W-M,y,W-2*M,8);y+=14;doc.setDrawColor(150,165,180);doc.line(M,y,W-M,y);y+=18;}
  function ensure(height){if(y+height>BOTTOM)newPage();}
  function row(cells,widths,header=false,start=0,count){
    const lineHeight=13,total=count??Math.max(1,...cells.map(cell=>cell.length)),height=8+total*lineHeight;
    let x=french?M:W-M;doc.setDrawColor(170,183,198);doc.setFillColor(header?228:255,header?235:255,header?244:255);
    for(let i=0;i<cells.length;i++){const width=widths[i]*(W-2*M),left=french?x:x-width;doc.setFillColor(header?228:255,header?235:255,header?244:255);doc.rect(left,y,width,height,'FD');cells[i].slice(start,start+total).forEach((line,j)=>text(line,french?left+5:left+width-5,y+15+j*lineHeight,width-10,header?9:10,header?'bold':'normal'));x+=french?width:-width;}y+=height;
  }
  newPage();
  for(const block of model.blocks||[]){
    if(block.kind!=='table'){
      const size=block.kind==='heading'?15:block.kind==='subheading'?12:10,weight=block.kind==='text'?'normal':'bold';
      for(const line of wrap(block.text,W-2*M,size,weight)){ensure(size+8);text(line,french?M:W-M,y,W-2*M,size,weight);y+=size+6;}y+=6;continue;
    }
    if(!block.rows?.length)continue;
    const widths=block.widths||Array(block.rows[0].length).fill(1/block.rows[0].length),hasHeader=block.header!==false;
    const head=hasHeader?block.rows[0].map((value,i)=>wrap(value,widths[i]*(W-2*M)-10,9,'bold')):null;
    const headerHeight=head?8+13*Math.max(...head.map(cell=>cell.length)):0;
    ensure(headerHeight+34);if(head)row(head,widths,true);
    for(const values of block.rows.slice(hasHeader?1:0)){
      const cells=values.map((value,i)=>wrap(value,widths[i]*(W-2*M)-10)),lines=Math.max(1,...cells.map(cell=>cell.length));let offset=0;
      while(offset<lines){
        let available=Math.floor((BOTTOM-y-8)/13);
        if(available<1||(offset===0&&lines<=40&&lines>available)){newPage();if(head)row(head,widths,true);available=Math.floor((BOTTOM-y-8)/13);}
        const count=Math.min(available,lines-offset);row(cells,widths,false,offset,count);offset+=count;
      }
    }y+=12;
  }
  if(model.includeFooter&&model.branding?.footer)for(const line of wrap(model.branding.footer,W-2*M,8)){ensure(16);text(line,french?M:W-M,y,W-2*M,8);y+=12;}
  footer();
  // Text and fonts are embedded; financial tables are never rasterized.
  return new Blob([doc.output('arraybuffer')],{type:'application/pdf'});
}
