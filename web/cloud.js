import { WebShopDatabase } from './web-database.js';
import { allOutbox, acknowledgeCloud, cloudStatus, configureCloud } from './outbox.js';
import { offerFile } from './web-export.js';
import { checkSnapshot } from './backup-contract.js';
import { validateState } from './database.js';
import { openPrivacyPolicy } from './privacy.js';
const t=(ar,fr)=>document.documentElement.lang==='fr'?fr:ar;
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
let running=false,nextAttempt=0,failures=0,lastAttempt=null,lastError='',dialog;
const api=(url,body)=>globalThis.ContaoService.serviceApi('/api/backup/'+url,body);
export async function syncCloud(force=false){
  if(running||globalThis.ContaoService?.isUpdateFrozen()||!navigator.onLine||document.visibilityState!=='visible'||!globalThis.ContaoRuntime?.isAuthenticated()||!force&&Date.now()<nextAttempt)return;
  running=true;let db;
  try{
    db=await new WebShopDatabase().open();const status=await cloudStatus(db);if(!status.config?.enabled||status.config.requiresReview)return;
    if(!force&&!status.config.batchInProgress&&status.ack&&Date.now()-status.ack.at<(status.config.cadenceMs||86400000))return;
    const rows=(await allOutbox(db)).filter(row=>row.streamId===status.config.streamId);if(!rows.length)return;
    lastAttempt=Date.now();await db.put('meta',{id:'cloud-attempt',value:{at:lastAttempt,error:null}});const events=[];let bytes=0;
    for(const row of rows.slice(0,50)){const size=new TextEncoder().encode(JSON.stringify(row.event)).length;if(size>9*1024*1024)throw Error(t('التغيير أكبر من حد الرفع. احتفظ بنسخة محلية وتواصل مع الدعم.','Modification trop volumineuse. Conservez une sauvegarde locale.'));if(bytes+size>9*1024*1024)break;events.push(row.event);bytes+=size;}
    await db.put('meta',{id:'cloud-config',value:{...status.config,batchInProgress:true}});
    const result=await globalThis.ContaoService.backupRequest('upload',{streamId:status.config.streamId,events});
    if(!result.durable||!Number.isSafeInteger(result.cursor)||result.cursor<events.at(-1).sequence)throw Error('Incomplete server acknowledgement');
    await acknowledgeCloud(db,status.config.streamId,result.cursor,result.versionId);await db.put('meta',{id:'cloud-config',value:{...status.config,batchInProgress:rows.length>events.length}});lastError='';failures=0;nextAttempt=Date.now()+1000;
  }catch(error){lastError=error.message;failures++;nextAttempt=Date.now()+Math.min(300000,5000*2**Math.min(failures,6))+Math.random()*1000;try{await db?.put('meta',{id:'cloud-attempt',value:{at:lastAttempt||Date.now(),error:String(lastError).slice(0,500),nextAttempt}});}catch{}}finally{db?.db.close();running=false;}
}
export function startCloud(){globalThis.ContaoBackup={isBusy:()=>running||!!dialog?.open};setInterval(()=>syncCloud(),60000);addEventListener('online',()=>syncCloud());document.addEventListener('visibilitychange',()=>syncCloud());setTimeout(()=>syncCloud(),3000);}
export async function openBackupPanel(){
  if(!globalThis.ContaoRuntime?.backupAllowed())throw Error(t('تحتاج صلاحية النسخ وحسابًا محليًا مفتوحًا.','Une session locale autorisée est requise.'));
  dialog?.remove();dialog=el('dialog');dialog.className='web-file-dialog';const title=el('h2',t('النسخ السحابي الاختياري','Sauvegarde en ligne facultative')),message=el('p');message.setAttribute('role','status');dialog.append(title,message);
  const close=el('button',t('إغلاق','Fermer'));close.onclick=()=>dialog.close();dialog.append(close);document.body.append(dialog);dialog.showModal();
  let db;
  try{
    db=await new WebShopDatabase().open();const scope=globalThis.ContaoService.scope,local=await cloudStatus(db);
    const stateLabel=el('p',t('تغييرات منتظرة: ','Modifications en attente : ')+local.pending+' · '+t('آخر حفظ مؤكد: ','Dernier envoi confirmé : ')+(local.ack?new Date(local.ack.at).toLocaleString():t('لم يتم بعد','Aucun')));dialog.prepend(stateLabel);
    if(lastAttempt||local.attempt?.at)dialog.append(el('p',t('آخر محاولة: ','Dernière tentative : ')+new Date(lastAttempt||local.attempt.at).toLocaleString()));if(lastError||local.attempt?.error)dialog.append(el('p',lastError||local.attempt.error));
    const sync=el('button',t('مزامنة الآن','Envoyer maintenant'));sync.onclick=async()=>{sync.disabled=true;await syncCloud(true);message.textContent=lastError||t('اكتملت المحاولة؛ التغييرات تحذف من الطابور فقط بعد تأكيد حفظها.','Tentative terminée ; la file est retirée uniquement après confirmation.');sync.disabled=false;};dialog.append(sync);
    const remote=await api('status',{appLicenseId:scope.licenseId});
    const notice=el('p',t('الرفع اختياري، ويشمل بيانات المحل ومستخدميه المحليين. يحتاج اشتراك نسخ مستقلًا. بعد انتهاء خدمة النسخ، تبقى النسخ قابلة للتنزيل للمخول لمدة 30 يومًا، ثم تحذف بمهمة مجدولة مع تنبيه في الحساب. بيانات جهازك تبقى مستقلة. الرفع يعمل أثناء فتح التطبيق، ولا نضمن تشغيله وهو مغلق.','L’envoi est facultatif et inclut le magasin et ses utilisateurs locaux. Abonnement distinct requis. Après expiration, téléchargement autorisé pendant 30 jours, puis suppression planifiée avec notification du compte. Les données locales restent indépendantes. Envoi pendant l’utilisation ; aucune exécution garantie lorsque l’application est fermée.'));dialog.append(notice);
    if(remote.versions?.warning)dialog.append(el('p',t('خدمة النسخ منتهية. نزّل نسخك قبل: ','Service expiré. Téléchargez avant : ')+new Date(remote.versions.deleteAfter).toLocaleDateString()));
    const licenses=remote.licenses.filter(l=>l.status==='approved'&&(l.endsAt===null||l.endsAt>Date.now()));
    if(licenses.length){
      const cadence=el('select');for(const [value,label]of [[86400000,t('يوميًا أثناء فتح التطبيق','Chaque jour pendant l’utilisation')],[604800000,t('أسبوعيًا أثناء فتح التطبيق','Chaque semaine pendant l’utilisation')],[60000,t('كل دقيقة أثناء الفتح','Chaque minute pendant l’utilisation')]]){const option=el('option',label);option.value=value;cadence.append(option);}dialog.append(cadence);
      const policy=el('button',t('قراءة سياسة الخصوصية والاحتفاظ','Lire la politique de confidentialité et de conservation'));policy.type='button';policy.onclick=openPrivacyPolicy;dialog.append(policy);
      const label=el('label'),consent=el('input');consent.type='checkbox';label.append(consent,document.createTextNode(t('قرأت سياسة الرفع والاحتفاظ وأوافق على بدء رفع بيانات هذا المحل.','J’ai lu et j’accepte l’envoi et la conservation de ce magasin.')));dialog.append(label);
      const enable=el('button',t('تفعيل النسخ لهذا المحل','Activer pour ce magasin'));enable.onclick=async()=>{
        enable.disabled=true;try{
          if(!consent.checked)throw Error(t('الموافقة الصريحة مطلوبة.','Accord explicite requis.'));
          const latest=remote.versions?.versions?.[0];if(latest&&!confirm(t('توجد نسخة سابقة. بدء سلسلة جديدة يجعل بيانات هذا الجهاز أحدث نسخة، مع الاحتفاظ بالسابقة للاسترداد. هل راجعت النسخة وتوافق؟','Une copie existe. La nouvelle série utilisera les données de cet appareil, tout en gardant les versions précédentes. Confirmer après vérification ?')))return;
          await api('consent',{shopId:scope.shopId,backupLicenseId:licenses[0].id,enabled:true,policyVersion:1});
          const streamId=crypto.randomUUID();await globalThis.ContaoService.backupRequest('open',{appLicenseId:scope.licenseId,installationId:scope.installationId,generation:remote.generation,streamId,replaceVersionId:latest?.id||null});
          await configureCloud(db,{enabled:true,streamId,generation:remote.generation,requiresReview:false,cadenceMs:Number(cadence.value)});await syncCloud(true);message.textContent=lastError||t('تم تفعيل النسخ وإرسال الدفعة الأولى.','Sauvegarde activée, premier lot envoyé.');
        }catch(error){message.textContent=error.message;}finally{enable.disabled=false;}
      };dialog.append(enable);
      const disable=el('button',t('إيقاف الرفع الاختياري','Désactiver les envois'));disable.onclick=async()=>{try{await api('consent',{shopId:scope.shopId,backupLicenseId:licenses[0].id,enabled:false,policyVersion:1});await db.put('meta',{id:'cloud-config',value:{...local.config,enabled:false}});message.textContent=t('توقف الرفع. لم تحذف بيانات الجهاز أو النسخ المحفوظة.','Envoi désactivé. Aucune donnée locale ni copie sauvegardée supprimée.');}catch(error){message.textContent=error.message;}};dialog.append(disable);
    }else dialog.append(el('p',t('لا يوجد اشتراك نسخ صالح. حفظ الجهاز والتصدير المحلي مستقلان.','Aucun abonnement sauvegarde actif. Stockage et export locaux indépendants.')));
    for(const version of remote.versions?.versions||[]){
      const section=el('section');section.append(el('p',new Date(version.created_at).toLocaleString()+' · '+Math.ceil(version.bytes/1024)+' KB'));
      const download=el('button',t('تنزيل نسخة محلية','Télécharger'));download.onclick=async()=>{try{const value=await globalThis.ContaoService.backupRequest('download',{versionId:version.id});await offerFile('contaonline-backup-'+version.id+'.json',new Blob([JSON.stringify(value.snapshot)],{type:'application/json'}));}catch(error){message.textContent=error.message;}};section.append(download);
      const restore=el('button',t('معاينة واستعادة','Aperçu et restauration'));restore.disabled=!globalThis.ContaoService.canWrite();restore.onclick=async()=>{
        restore.disabled=true;try{
          const result=await globalThis.ContaoService.backupRequest('download',{versionId:version.id}),snapshot=checkSnapshot(result.snapshot,validateState);const preview=t('منتجات / مستندات / أطراف: ','Produits / pièces / tiers : ')+[snapshot.state.products.length,snapshot.state.records.length,snapshot.state.parties.length].join(' / ');
          if(!confirm(preview+'\n'+t('ستستبدل بيانات المحل المحلي وتُحفظ نسخة أمان أولًا. الاستعادة لا تجدد الاشتراك وتوقف الرفع حتى المراجعة. ستحتاج كلمة مرور المستخدم المحلي من النسخة. هل تؤكد؟','Les données locales seront remplacées après une copie de sécurité. Aucun renouvellement ; envoi suspendu jusqu’à vérification. Le mot de passe local de la copie sera nécessaire. Confirmer ?')))return;
          await db.load();await db.replace(snapshot.state,snapshot.users);location.reload();
        }catch(error){message.textContent=error.message;}finally{restore.disabled=!globalThis.ContaoService.canWrite();}
      };section.append(restore);dialog.append(section);
    }
  }catch(error){message.textContent=error.message;}finally{dialog.addEventListener('close',()=>db?.db.close(),{once:true});}
}
