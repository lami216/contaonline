import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createApp, stagingDigest } from '../server/app.mjs';
import { diffSnapshot } from '../shared/backup.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),manifest=JSON.parse(await readFile(new URL('../dist/build-manifest.json',import.meta.url),'utf8'));
let rawBytes=0,potentialGzipBytes=0;for(const file of manifest.files){const bytes=await readFile(new URL('../dist/'+file.path,import.meta.url));rawBytes+=bytes.length;potentialGzipBytes+=gzipSync(bytes).length;}
const secret=randomBytes(32).toString('base64url'),app=await createApp({distDirectory:root+'dist',stagingHash:stagingDigest('synthetic',secret)}),authorization='Basic '+Buffer.from('synthetic:'+secret).toString('base64'),latencies=[];
try{for(let n=0;n<1000;n++){const started=performance.now();const response=await app.inject({url:'/health/live',headers:{authorization}});if(response.statusCode!==200)throw Error('Smoke request failed');latencies.push(performance.now()-started);}}finally{await app.close();}
latencies.sort((a,b)=>a-b);
const base={format:'contaonline-backup',schemaVersion:1,state:{products:Array.from({length:10000},(_,i)=>({id:i+1,name:'Synthetic product '+i,price:100,cost:50,stocks:{main:10}}))},users:[]},next=structuredClone(base);next.state.products[5000].price=125;
const started=performance.now(),operations=diffSnapshot(base,next),deltaMs=performance.now()-started;
const result={measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,buildVersion:manifest.version,scope:'Synthetic local inject smoke and payload measurements; not a network/concurrency/user-capacity benchmark',build:{files:manifest.files.length,precacheEntries:manifest.precacheEntries,rawBytes,potentialGzipBytes,gzipEnabledOnReviewServer:false},sequentialHealthInject:{requests:1000,p50Ms:latencies[500],p95Ms:latencies[950],maxMs:latencies.at(-1)},backupExample:{products:10000,snapshotBytes:Buffer.byteLength(JSON.stringify(base)),deltaBytes:Buffer.byteLength(JSON.stringify(operations)),operations:operations.length,diffMs:deltaMs},rssBytes:process.memoryUsage().rss};
await mkdir(root+'docs/evidence',{recursive:true});await writeFile(root+'docs/evidence/MEASUREMENTS.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
