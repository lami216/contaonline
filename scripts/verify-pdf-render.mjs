import { jsPDF } from 'jspdf';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
globalThis.jspdf={jsPDF};
globalThis.fetch=async name=>new Response(await readFile(path.join(root,'dist/app/assets',path.basename(String(name)))));
const modulePath='../dist/app/web-report-pdf.js';const {reportPdf}=await import(modulePath);
const directory=path.join(root,'private/pdf-review');await mkdir(directory,{recursive:true});
for(const language of ['ar','fr']){
  const rows=[['المنتج','الكمية','السعر','الإجمالي'],...Array.from({length:70},(_,i)=>[i%2?'عطر موريتاني فاخر للاختبار':'Parfum test 10 ml',i+1,1250.5,(i+1)*1250.5])];
  if(language==='fr')rows[0]=['Produit','Quantité','Prix','Total'];
  const blob=await reportPdf({brand:'الكرنه',language,created:'2026-10-23',includeFooter:true,branding:{phone:'22 00 00 00',address:'نواكشوط - Mauritanie',footer:'شكرًا لزيارتكم'},blocks:[{kind:'heading',text:language==='fr'?'Rapport des ventes':'تقرير المبيعات'},{kind:'text',text:language==='fr'?'Document de contrôle synthétique, sans données client.':'تقرير تجريبي لمراجعة العربية والفرنسية والأرقام؛ لا بيانات عملاء حقيقية.'},{kind:'table',rows,widths:[0.46,0.12,0.18,0.24]}]});
  await writeFile(path.join(directory,language+'.pdf'),new Uint8Array(await blob.arrayBuffer()));
  console.log(JSON.stringify({language,bytes:blob.size,rows:rows.length}));
}
