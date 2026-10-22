// Native decoding stays on this device; no frames are uploaded.
export async function barcodeSupport(env=globalThis){
 if(!env.isSecureContext)return 'قراءة الكاميرا تحتاج اتصالًا آمنًا أو تشغيل الموقع محليًا.';
 if(!env.navigator?.mediaDevices?.getUserMedia)return 'الكاميرا غير متاحة في هذا المتصفح. أدخل الباركود يدويًا.';
 if(!env.BarcodeDetector)return 'هذا المتصفح لا يدعم قراءة الباركود بالكاميرا. أدخله يدويًا أو جرّب متصفحًا يدعمها.';
 const wanted=['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','codabar','qr_code'];
 const formats=(await env.BarcodeDetector.getSupportedFormats()).filter(f=>wanted.includes(f));
 return formats.length?formats:'أنواع الباركود المطلوبة غير مدعومة في هذا المتصفح.';
}
export async function scanProductBarcode(input,{onError=()=>{}}={}){
 let formats;try{formats=await barcodeSupport()}catch{onError('تعذّر تهيئة قارئ الباركود. أدخله يدويًا.');return}
 if(typeof formats==='string'){onError(formats);return}
 let stream=null,timer=null,closed=false,previous='',matches=0,started=Date.now();
 const overlay=document.createElement('div');overlay.className='barcode-camera-overlay';
 overlay.innerHTML='<section class="barcode-camera-dialog" role="dialog" aria-modal="true" aria-label="مسح الباركود"><header><h2>مسح الباركود</h2><button type="button" aria-label="إغلاق الكاميرا">×</button></header><div class="barcode-camera-preview"><video autoplay muted playsinline></video><span class="barcode-camera-guide"></span></div><p role="status">وجّه الكاميرا نحو الباركود وثبّت الجهاز قليلًا</p></section>';
 const video=overlay.querySelector('video'),status=overlay.querySelector('[role=status]'),closeButton=overlay.querySelector('button'),beforeFocus=document.activeElement;
 const stop=()=>{if(closed)return;closed=true;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());video.srcObject=null;overlay.remove();document.removeEventListener('keydown',key,true);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',stop);beforeFocus?.focus()};
 const key=e=>{if(e.key==='Escape'){e.stopPropagation();stop()}if(e.key==='Tab'){e.preventDefault();closeButton.focus()}};
 const hidden=()=>{if(document.hidden)stop()};closeButton.addEventListener('click',stop);overlay.addEventListener('click',e=>{if(e.target===overlay)stop()});
 (document.querySelector('#phone')||document.body).append(overlay);closeButton.focus();document.addEventListener('keydown',key,true);document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',stop);
 try{
  const detector=new BarcodeDetector({formats});
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
  if(closed){stream.getTracks().forEach(t=>t.stop());return}
  video.srcObject=stream;await video.play();if(closed)return;
  const read=async()=>{
   if(closed)return;
   if(Date.now()-started>45000){stop();onError('لم يُقرأ الباركود. أعد المحاولة بإضاءة أوضح أو أدخله يدويًا.');return}
   try{
    if(video.readyState>=2){const codes=await detector.detect(video);if(closed)return;const value=codes.find(c=>c.rawValue?.trim()&&c.rawValue.length<=128)?.rawValue.trim();if(value){matches=value===previous?matches+1:1;previous=value;if(matches>=2){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));stop();input.focus();return}}else{previous='';matches=0}}
   }catch{stop();onError('تعذّرت قراءة الصورة. يمكنك إدخال الباركود يدويًا.');return}
   timer=setTimeout(read,180);
  };started=Date.now();status.textContent='وجّه الباركود داخل الإطار؛ تُغلق الكاميرا تلقائيًا بعد القراءة.';read();
 }catch(e){if(closed)return;stop();onError(({NotAllowedError:'لم يُسمح باستخدام الكاميرا. يمكنك إدخال الباركود يدويًا.',NotFoundError:'لم يُعثر على كاميرا متاحة.',NotReadableError:'الكاميرا مشغولة أو غير متاحة. أغلق التطبيق الذي يستخدمها ثم أعد المحاولة.'})[e.name]||'تعذّر تشغيل الكاميرا. يمكنك إدخال الباركود يدويًا.')}
}
