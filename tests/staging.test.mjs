import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp, stagingDigest } from '../server/app.mjs';
test('staging denies anonymous access to every route including assets, APIs and health',async()=>{
  const user='review-test',secret=randomBytes(32).toString('base64url');
  const app=await createApp({distDirectory:fileURLToPath(new URL('../dist',import.meta.url)),stagingHash:stagingDigest(user,secret)});
  try{
    for(const url of ['/','/app/','/app/app.js','/app/sw.js','/app/assets/StitchArabic.ttf','/api/public/config','/api/activation/keys','/admin/','/health/live','/health/ready']){
      const response=await app.inject({url});assert.equal(response.statusCode,401,url);assert.equal(response.headers['cache-control'],'no-store');
    }
    const authorization='Basic '+Buffer.from(user+':'+secret).toString('base64');
    assert.equal((await app.inject({url:'/app/',headers:{authorization}})).statusCode,200);
    assert.equal((await app.inject({url:'/api/public/config',headers:{authorization}})).json().apk.enabled,false);
    assert.equal((await app.inject({url:'/approved-runtime/app.js',headers:{authorization}})).statusCode,404);
    assert.equal((await app.inject({url:'/app/%2f..%2f.env',headers:{authorization}})).statusCode,400);
    assert.equal((await app.inject({url:'/health/ready',headers:{authorization}})).statusCode,503);
  }finally{await app.close();}
});
