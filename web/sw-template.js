const VERSION=__VERSION__;
const ASSETS=__ASSETS__;
const CACHE='contaonline-app-'+VERSION;
const known=new Map(ASSETS.map(asset=>[asset.url,asset]));
async function checkedResponse(asset){
  const response=await fetch(asset.url,{cache:'no-store',credentials:'same-origin'});
  if(!response.ok)throw Error('Offline resource failed: '+asset.url);
  const bytes=await response.clone().arrayBuffer();
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  if(digest!==asset.sha256)throw Error('Offline resource digest mismatch');
  return response;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  try{const cache=await caches.open(CACHE);for(const asset of ASSETS)await cache.put(asset.url,await checkedResponse(asset));}
  catch(error){await caches.delete(CACHE);throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('contaonline-app-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin||!url.pathname.startsWith('/app/'))return;
  const pathname=url.pathname==='/app/'?'/app/index.html':url.pathname;
  const asset=known.get(pathname);if(!asset)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),hit=await cache.match(asset.url);if(hit)return hit;
    try{const response=await checkedResponse(asset);await cache.put(asset.url,response.clone());return response;}
    catch{return new Response('Offline resource unavailable; reopen online to repair',{status:503,headers:{'content-type':'text/plain'}});}
  })());
});
const pending=new Map();
self.addEventListener('message',event=>{
  if(event.data?.type==='CACHE_STATUS'){event.waitUntil((async()=>{const cache=await caches.open(CACHE);let ok=true;for(const asset of ASSETS)if(!await cache.match(asset.url)){ok=false;break;}event.ports[0]?.postMessage({ok,version:VERSION,resources:ASSETS.length});})());}
  if(event.data?.type==='ACTIVATE_ACK'){
    const request=pending.get(event.data.requestId);if(request&&request.clients.has(event.source?.id)){request.clients.delete(event.source.id);request.ok=request.ok&&event.data.ok===true;if(!request.clients.size)request.finish();}
  }
  if(event.data?.type==='SAFE_ACTIVATE')event.waitUntil((async()=>{
    const windows=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(client=>new URL(client.url).pathname.startsWith('/app/'));
    const requestId=crypto.randomUUID();
    const ok=await new Promise(resolve=>{
      const request={clients:new Set(windows.map(client=>client.id)),ok:true,finish:()=>{clearTimeout(timer);pending.delete(requestId);resolve(request.ok);}};
      const timer=setTimeout(()=>{pending.delete(requestId);resolve(false);},6000);pending.set(requestId,request);
      if(!windows.length)request.finish();else for(const client of windows)client.postMessage({type:'CAN_ACTIVATE',requestId});
    });
    event.ports[0]?.postMessage({ok});
    if(ok)await self.skipWaiting();
  })());
});
