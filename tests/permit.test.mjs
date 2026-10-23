import test from 'node:test';
import assert from 'node:assert/strict';
import { base64url, fingerprint, permitMessage, verifyPermit } from '../shared/permit.mjs';
async function fixture(){
  const issuer=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const install=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const publicJwk=await crypto.subtle.exportKey('jwk',install.publicKey),issuerJwk=await crypto.subtle.exportKey('jwk',issuer.publicKey);
  const identity={accountId:'account-A',id:'installation-A',publicJwk};
  const now=Date.now(),envelope={schema:'contaonline-permit',version:1,kid:'independent-test-key',payload:{accountId:identity.accountId,shopId:'shop-A',licenseId:'license-A',installationId:identity.id,keyFingerprint:await fingerprint(publicJwk),storeName:'متجر الاختبار',customerName:'عميل اختبار',issuedAt:now-1000,expiresAt:now+60000,entitlements:['app.use']},signature:''};
  envelope.signature=base64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},issuer.privateKey,permitMessage(envelope)));
  return {envelope,identity,keys:{'independent-test-key':issuerJwk}};
}
test('signed permits bind account, installation and public key; expiry preserves verified read scope',async()=>{
  const f=await fixture(),active=await verifyPermit(f.envelope,f.keys,f.identity);
  assert.equal(active.canWrite,true);
  const expired=await verifyPermit(f.envelope,f.keys,f.identity,f.envelope.payload.expiresAt);
  assert.equal(expired.canWrite,false);assert.equal(expired.payload.shopId,'shop-A');
  await assert.rejects(verifyPermit(f.envelope,f.keys,{...f.identity,accountId:'account-B'}));
  await assert.rejects(verifyPermit(f.envelope,f.keys,{...f.identity,id:'another-installation'}));
  await assert.rejects(verifyPermit({...f.envelope,payload:{...f.envelope.payload,expiresAt:f.envelope.payload.expiresAt+10000}},f.keys,f.identity));
  await assert.rejects(verifyPermit({...f.envelope,kid:'unknown'},f.keys,f.identity));
  await assert.rejects(verifyPermit({...f.envelope,signature:f.envelope.signature+'='},f.keys,f.identity));
});
test('private verification JWK and unexpected entitlement are rejected',async()=>{
  const f=await fixture();await assert.rejects(verifyPermit(f.envelope,{'independent-test-key':{...f.keys['independent-test-key'],d:'private'}},f.identity));
  await assert.rejects(verifyPermit({...f.envelope,payload:{...f.envelope.payload,entitlements:['arbitrary-admin']}},f.keys,f.identity));
});
