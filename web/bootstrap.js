import { currentActivation, identityFor, installPermit, proof, readService, writeService } from './service-store.js';
import { preparePwa, refreshOfflineStatus } from './pwa.js';
const language=()=>localStorage.getItem('alkarna-site-language')==='fr'?'fr':'ar';
const t=(ar,fr)=>language()==='fr'?fr:ar;
const root=document.getElementById('phone');
let activation=null,csrf=null,shopBooted=false;
function notice(text){let target=document.getElementById('web-message')||document.querySelector('[data-web-message]');if(!target){target=document.createElement('p');target.dataset.webMessage='';document.getElementById('web-pwa-status')?.append(target);}target.textContent=text;}
function element(tag,text){const node=document.createElement(tag);if(text)node.textContent=text;return node;}
async function api(url,body){
  const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(body)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.message||t('تعذّر إتمام الطلب. حاول لاحقًا.','La demande a échoué. Réessayez plus tard.'));
  return result;
}
async function requireWrite(scope){
  const active=await currentActivation();
  if(!active||active.payload.accountId!==scope.accountId||active.payload.shopId!==scope.shopId)throw Error(t('تغيّر الحساب المفتوح. أعد فتح المحل.','Le compte actif a changé. Rouvrez le magasin.'));
  const record=active.record,now=Date.now(),previous=record.maxWallMs||active.payload.issuedAt;
  if(now<previous-120000){record.restriction='clock-rollback';await writeService('permit:'+active.payload.accountId,record);}
  activation={...active,record};
  if(record.restriction||!active.canWrite)throw Error(t('الترخيص للعرض والتصدير فقط. اتصل بالخدمة للتجديد أو المراجعة.','Licence en lecture et export uniquement. Connectez-vous pour renouveler ou vérifier.'));
  record.maxWallMs=Math.max(now,previous);await writeService('permit:'+active.payload.accountId,record);activation={...active,record};
}
function canWrite(){return !!activation?.canWrite&&!activation.record.restriction&&Date.now()>=activation.record.maxWallMs-120000&&Math.max(Date.now(),activation.record.maxWallMs)<activation.payload.expiresAt;}
const readActions=new Set(['site:login','site:logout','site:account-menu','site:support','site:audit','site:backup','backup:save','site:previous-backup','site:export','site:export-excel','site:export-pdf','site:export-print','site:print','close','back','cancel','print']);
async function allowAction(action,permissionFor){
  if(canWrite()){try{await requireWrite(globalThis.ContaoService.scope);return true;}catch(error){notice(error.message);}}
  if(readActions.has(action)||/^(site:language:|appearance:|go:home$|site:feature:document-(output|pdf|excel)$)/.test(action))return true;
  let capability;try{capability=permissionFor(action);}catch{}
  if(capability?.endsWith('.view'))return true;
  // Navigation/filtering with no capability is read-only; durable business writes have a separate database gate.
  if(!capability&&/^(go:|invoice:|ledger:|product:|account:|partytab:|partytype:|explain:|source-location:|page:|sort:|period:|filter:|search:)/.test(action))return true;
  notice(t('العرض والتصدير متاحان؛ العمليات الجديدة تحتاج ترخيصًا ساريًا.','Lecture et export disponibles ; les nouvelles opérations nécessitent une licence valide.'));return false;
}
async function bootShop(active){
  if(shopBooted){location.reload();return;}shopBooted=true;
  activation=active;
  const scope={accountId:active.payload.accountId,shopId:active.payload.shopId};
  globalThis.ContaoService={scope,canWrite,requireWrite,allowAction,setupIdentity:()=>({name:activation.payload.customerName,shop:activation.payload.storeName})};
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./engine.js';script.onload=resolve;script.onerror=()=>reject(Error('تعذّر فتح ملفات التطبيق'));document.body.append(script);});
  await import('./app.js');
  await refreshOfflineStatus();
  if(!canWrite())notice(t('وضع العرض والتصدير فقط؛ بيانات المحل محفوظة.','Mode lecture et export ; les données restent conservées.'));
}
function renderGate(error=''){
  document.documentElement.lang=language();document.documentElement.dir=language()==='fr'?'ltr':'rtl';
  root.replaceChildren();const main=element('main');main.className='auth-screen';const card=element('section');card.className='auth-card';
  card.append(element('h1',t('تفعيل نسخة الويب','Activer la version web')),element('p',t('الاتصال مطلوب لأول تفعيل. حساب الخدمة منفصل عن مستخدمي المحل.','Une connexion est requise pour la première activation. Le compte de service est distinct des utilisateurs locaux.')));
  const picker=element('div');for(const [value,label]of [['ar','العربية'],['fr','Français']]){const button=element('button',label);button.type='button';button.onclick=()=>{localStorage.setItem('alkarna-site-language',value);renderGate();};picker.append(button);}card.append(picker);
  const form=element('form');form.id='service-login';const user=element('input'),password=element('input');
  user.name='username';user.autocomplete='username';user.required=true;password.name='password';password.type='password';password.autocomplete='current-password';password.required=true;
  for(const [label,input]of [[t('حساب الخدمة','Compte de service'),user],[t('كلمة المرور','Mot de passe'),password]]){const field=element('label',label);field.append(input);form.append(field);}
  const submit=element('button',t('دخول وتفعيل','Connexion et activation'));submit.type='submit';submit.className='primary';form.append(submit);
  const message=element('p',error);message.id='web-message';message.setAttribute('role','status');card.append(form,message);
  const info=element('p',t('حذف بيانات الموقع قد يحذف بيانات المحل والمفتاح. احتفظ بنسخ خارج المتصفح.','Effacer les données du site peut supprimer les données et la clé. Conservez des sauvegardes externes.'));card.append(info);main.append(card);root.append(main);
  form.onsubmit=async event=>{
    event.preventDefault();submit.disabled=true;message.textContent=t('جارٍ التحقق…','Vérification…');
    try{
      const session=await api('/api/session/login',{username:user.value,password:password.value});csrf=session.csrfToken;
      if(!session.account?.id||!session.licenses?.length)throw Error(t('لا يوجد اشتراك متاح للتفعيل. تواصل مع الإدارة.','Aucun abonnement activable. Contactez l’administration.'));
      let license=session.licenses[0];
      if(session.licenses.length>1){const selected=await chooseLicense(session.licenses);if(!selected)return;license=selected;}
      const identity=await identityFor(session.account.id);
      const challenge=await api('/api/activation/challenge',{licenseId:license.id,installationId:identity.id,publicJwk:identity.publicJwk});
      const result=await api('/api/activation/enroll',{challengeId:challenge.id,signature:await proof(identity,challenge.message)});
      if(result.pending)throw Error(t('يوجد نشاط حديث متعارض؛ الطلب معلّق لمراجعة الإدارة.','Une activité récente entre en conflit. La demande attend une vérification.'));
      await installPermit(result.permit,result.keys,identity);await bootShop(await currentActivation());
    }catch(failure){message.textContent=failure.message;}finally{password.value='';submit.disabled=false;}
  };
}
async function chooseLicense(licenses){
  const dialog=element('dialog');dialog.className='web-file-dialog';dialog.append(element('h2',t('اختر المحل','Choisir le magasin')));
  return new Promise(resolve=>{
    for(const license of licenses){const button=element('button',license.storeName);button.onclick=()=>{dialog.close();resolve(license);};dialog.append(button);}
    dialog.addEventListener('cancel',()=>resolve(null));dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  });
}
globalThis.ContaoPwa={notice};
await preparePwa().catch(error=>notice(error.message));
try{
  const active=await currentActivation();
  if(active)await bootShop(active);else renderGate();
}catch(error){renderGate(error.message);}
setInterval(()=>{if(activation&&!canWrite()){refreshOfflineStatus();globalThis.ContaoPwa.notice(t('العرض والتصدير فقط؛ جدّد الترخيص لاستئناف التسجيل.','Lecture et export uniquement ; renouvelez la licence.'));}},15000);
