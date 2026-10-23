import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
/** @type {Record<string,string>} */
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.css':'text/css; charset=utf-8','.png':'image/png','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
/** @param {string} username @param {string} secret */
export function stagingDigest(username,secret){return createHash('sha256').update(username+':'+secret).digest();}
/** @param {{distDirectory:string,stagingHash:Buffer,publicConfig?:object|(()=>object),registerApi?:(app:import('fastify').FastifyInstance)=>Promise<void>}} options */
export async function createApp(options){
  if(options.stagingHash?.length!==32)throw Error('A private staging access gate is required');
  const app=Fastify({logger:false,bodyLimit:65536,trustProxy:false});
  app.setErrorHandler((error,request,reply)=>{const failure=/** @type {Error & {statusCode?:number}} */(error);const status=failure.statusCode||500;reply.code(status).send({message:status>=500?'Service request failed':failure.message,requestId:request.id});});
  const manifest=JSON.parse(await readFile(path.join(options.distDirectory,'build-manifest.json'),'utf8'));
  /** @type {Map<string,{path:string,sha256:string}>} */
  const files=new Map(manifest.files.map(/** @param {{path:string,sha256:string}} file */file=>['/'+file.path,file]));
  /** @type {Map<string,{count:number,until:number}>} */
  const failures=new Map();
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('cache-control','no-store').header('x-content-type-options','nosniff').header('referrer-policy','same-origin').header('x-frame-options','DENY');
    reply.header('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'");
    const now=Date.now(),previous=failures.get(request.ip);
    if(previous&&previous.until>now&&previous.count>=30)return reply.code(429).header('retry-after','60').send({message:'حاول لاحقًا'});
    const authorization=request.headers.authorization;
    const bytes=authorization?.startsWith('Basic ')?Buffer.from(authorization.slice(6),'base64'):Buffer.alloc(0);
    const hash=createHash('sha256').update(bytes).digest();
    if(!bytes.length||!timingSafeEqual(hash,options.stagingHash)){
      const state=previous&&previous.until>now?previous:{count:0,until:now+60000};state.count++;failures.set(request.ip,state);
      return reply.code(401).header('www-authenticate','Basic realm="Private review", charset="UTF-8"').send({message:'Private staging access required'});
    }
    if(previous)failures.delete(request.ip);
    if(failures.size>10000)for(const [ip,state]of failures)if(state.until<now)failures.delete(ip);
  });
  app.get('/health/live',async()=>({status:'up'}));
  app.get('/health/ready',async(_,reply)=>reply.code(503).send({status:'not-release-ready',phase:manifest.phase}));
  app.get('/api/public/config',async()=>typeof options.publicConfig==='function'?options.publicConfig():options.publicConfig||{apk:{enabled:false,url:null,version:null}});
  if(options.registerApi)await options.registerApi(app);
  app.get('/*',async(request,reply)=>{
    if(/%2f|%5c|%00|\\/i.test(request.url))return reply.code(400).send();
    let pathname=new URL(request.url,'http://local.invalid').pathname;
    if(pathname.startsWith('/api/'))return reply.code(404).send({message:'Not found'});
    if(pathname==='/')pathname='/index.html';if(pathname==='/app'||pathname==='/app/')pathname='/app/index.html';if(pathname==='/admin'||pathname==='/admin/')pathname='/admin/index.html';
    const entry=files.get(pathname);if(!entry)return reply.code(404).send({message:'Not found'});
    const bytes=await readFile(path.join(options.distDirectory,entry.path));
    if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)return reply.code(503).send({message:'Build integrity check failed'});
    reply.type(TYPES[path.extname(entry.path)]||'application/octet-stream');
    if(entry.path==='app/sw.js')reply.header('service-worker-allowed','/app/');
    return bytes;
  });
  return app;
}
