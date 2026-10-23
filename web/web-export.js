const t = (ar,fr) => document.documentElement.lang === 'fr' ? fr : ar;
export async function offerFile(name, blob) {
  if (!(blob instanceof Blob) || blob.size > 64*1024*1024) throw Error(t('حجم الملف غير مدعوم','Fichier trop volumineux'));
  const file = new File([blob], name, {type:blob.type || 'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  const dialog = document.createElement('dialog'); dialog.className = 'web-file-dialog';
  const title = document.createElement('h2'); title.textContent=t('الملف جاهز للحفظ','Fichier prêt à enregistrer');
  const filename=document.createElement('p'); filename.textContent=name;
  const explanation=document.createElement('p'); explanation.textContent=t('يُنشأ على جهازك دون رفع بيانات المحل. اختر التنزيل أو الحفظ في الملفات عبر المشاركة.','Créé sur votre appareil sans envoi. Téléchargez ou utilisez Partager pour enregistrer dans Fichiers.');
  const download=document.createElement('a');download.href=url;download.download=name;download.textContent=t('تنزيل الملف','Télécharger');download.className='web-primary';
  const share=document.createElement('button');share.type='button';share.textContent=t('مشاركة أو حفظ في الملفات','Partager ou enregistrer dans Fichiers');
  share.hidden=!navigator.canShare?.({files:[file]});
  const status=document.createElement('p');status.setAttribute('role','status');
  share.onclick=async()=>{try{await navigator.share({files:[file],title:name});status.textContent=t('أُرسل إلى خيار المشاركة الذي حددته','Envoyé à la destination choisie');}catch(error){if(error.name!=='AbortError')status.textContent=t('تعذّرت المشاركة؛ استخدم رابط التنزيل','Partage impossible ; utilisez Télécharger');}};
  download.onclick=()=>{status.textContent=t('بدأ التنزيل؛ تحقّق من وجود الملف ضمن التنزيلات','Téléchargement lancé ; vérifiez votre dossier de téléchargements');};
  const close=document.createElement('button');close.type='button';close.textContent=t('إغلاق','Fermer');close.onclick=()=>dialog.close();
  dialog.append(title,filename,explanation,download,share,status,close);document.body.append(dialog);
  dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove();},{once:true});dialog.showModal();
  return { prepared:true };
}
