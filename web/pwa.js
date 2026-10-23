import { currentActivation, writeService } from './service-store.js';
let registration,preparing,cacheComplete=false,requestingUpdate=false;
const t=(ar,fr)=>document.documentElement.lang==='fr'?fr:ar;
function banner(){
  let panel=document.getElementById('web-pwa-status');
  if(!panel){panel=document.createElement('section');panel.id='web-pwa-status';panel.className='web-pwa-status';panel.setAttribute('aria-live','polite');document.body.prepend(panel);}
  return panel;
}
export async function refreshOfflineStatus(){
  const panel=banner();panel.replaceChildren();
  const text=document.createElement('span');text.dataset.offlineStatus='';text.textContent=t('جارٍ تجهيز الاستخدام دون إنترنت…','Préparation du mode hors ligne…');panel.append(text);
  try{
    await writeService('storage-probe',{at:Date.now()});
    const active=await currentActivation();
    if(cacheComplete&&active&&globalThis.ContaoService?.canWrite())text.textContent=t('جاهز للاستخدام دون إنترنت ضمن صلاحية التصريح','Prêt hors ligne pendant la validité du permis');
    else if(cacheComplete&&active)text.textContent=t('جاهز للعرض والتصدير محليًا','Prêt en lecture et export local');
    else if(!active)text.textContent=t('أكمل التفعيل للبدء؛ التجهيز لا يعني تفعيل الاشتراك','Terminez l’activation ; la préparation ne vaut pas abonnement');
    if(active&&globalThis.ContaoService?.reconnect){const account=document.createElement('button');account.type='button';account.textContent=t('الحساب والتجديد','Compte et renouvellement');account.onclick=()=>globalThis.ContaoService.reconnect();panel.append(account);}
    if(active&&globalThis.ContaoService?.openBackupPanel){const backup=document.createElement('button');backup.type='button';backup.textContent=t('النسخ الاختياري','Sauvegarde facultative');backup.onclick=()=>globalThis.ContaoService.openBackupPanel().catch(error=>globalThis.ContaoPwa.notice(error.message));panel.append(backup);}
    if(registration?.waiting){
      const update=document.createElement('button');update.type='button';update.textContent=t('تحديث آمن','Mettre à jour');update.onclick=()=>requestUpdate();panel.append(update);
    }
    if(navigator.storage?.persist&&!await navigator.storage.persisted()){
      const persist=document.createElement('button');persist.type='button';persist.textContent=t('تعزيز حفظ البيانات','Renforcer la conservation');
      persist.onclick=async()=>{const ok=await navigator.storage.persist();persist.textContent=ok?t('تم تعزيز الحفظ؛ مسح بيانات الموقع يحذفها','Conservation renforcée ; effacer le site supprime les données'):t('احتفظ بنسخ خارج المتصفح','Conservez des copies externes');};panel.append(persist);
    }
  }catch{ text.textContent=t('لم يكتمل التجهيز. تحقّق من التخزين والاتصال.','Préparation incomplète. Vérifiez le stockage et la connexion.');}
}
function messageWorker(worker,message){
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel();const timeout=setTimeout(()=>reject(Error('Worker response timeout')),10000);
    channel.port1.onmessage=event=>{clearTimeout(timeout);resolve(event.data);};worker.postMessage(message,[channel.port2]);
  });
}
async function requestUpdate(){
  const worker=registration?.waiting;if(!worker)return;
  requestingUpdate=true;
  const result=await messageWorker(worker,{type:'SAFE_ACTIVATE'});
  if(!result.ok){requestingUpdate=false;globalThis.ContaoPwa.notice(t('أكمل الحفظ وأغلق النوافذ غير المستجيبة ثم أعد المحاولة.','Terminez l’enregistrement et fermez les fenêtres non répondantes, puis réessayez.'));return;}
}
export async function preparePwa(){
  if(preparing)return preparing;
  preparing=(async()=>{
    if(!('serviceWorker'in navigator))throw Error(t('المتصفح لا يدعم تشغيل النسخة دون إنترنت','Ce navigateur ne prend pas en charge le mode hors ligne'));
    registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    navigator.serviceWorker.addEventListener('message',event=>{
      if(event.data?.type==='CAN_ACTIVATE'){
        const safe=globalThis.ContaoRuntime?.saveBeforeUpdate?.()??(!!document.querySelector('#service-login')&&!document.querySelector('#service-login button:disabled'));
        event.source?.postMessage({type:'ACTIVATE_ACK',requestId:event.data.requestId,ok:safe});
      }
    });
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(requestingUpdate)location.reload();});
    registration.addEventListener('updatefound',()=>{
      const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')refreshOfflineStatus();});
    });
    const ready=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error(t('موارد الأوفلاين لم تكتمل','Ressources hors ligne incomplètes'))),15000))]);
    const result=await messageWorker(ready.active,{type:'CACHE_STATUS'});cacheComplete=!!result.ok;
    globalThis.ContaoPwa={...globalThis.ContaoPwa,prepare:preparePwa,notice:text=>{
      const panel=banner();let message=panel.querySelector('[data-web-message]');
      if(!message){message=document.createElement('p');message.dataset.webMessage='';panel.append(message);}message.textContent=text;
    }};
    await refreshOfflineStatus();return result;
  })();
  return preparing;
}
