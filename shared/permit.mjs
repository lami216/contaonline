/** Canonical signed web-permit contract, shared by the server and browser.
 * @typedef {{accountId:string,shopId:string,licenseId:string,installationId:string,keyFingerprint:string,storeName:string,customerName:string,issuedAt:number,expiresAt:number,entitlements:string[]}} PermitPayload
 * @typedef {{schema:string,version:number,kid:string,payload:PermitPayload,signature:string}} Permit
 * @typedef {{accountId:string,id:string,publicJwk:JsonWebKey}} Installation
 */
/** @param {unknown} value @returns {string} */
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(/** @type {Record<string,unknown>} */ (value)[key])).join(',') + '}';
  if(value===undefined||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint'||typeof value==='number'&&!Number.isFinite(value))throw Error('Unsupported signed value');
  return JSON.stringify(value);
}
/** @param {ArrayBuffer|Uint8Array} bytes */
export function base64url(bytes) {
  let binary = ''; for (const byte of (bytes instanceof Uint8Array?bytes:new Uint8Array(bytes))) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
/** @param {string} value */
export function decode64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw Error('Invalid signature encoding');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (base64url(bytes) !== value) throw Error('Noncanonical signature encoding');
  return bytes;
}
/** @param {JsonWebKey} jwk */
export async function fingerprint(jwk) {
  const value = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))));
}
/** @param {Permit} envelope */
export function permitMessage(envelope) {
  return new TextEncoder().encode(canonical({ schema: envelope.schema, version: envelope.version, kid: envelope.kid, payload: envelope.payload }));
}
/** @param {Permit} envelope @param {Record<string,JsonWebKey>} keys @param {Installation} identity @param {number} now */
export async function verifyPermit(envelope, keys, identity, now = Date.now()) {
  if (!envelope || envelope.schema !== 'contaonline-permit' || envelope.version !== 1 || typeof envelope.kid !== 'string') throw Error('تصريح الويب غير صالح');
  const p = envelope.payload;
  if (!p || ![p.accountId,p.shopId,p.licenseId,p.installationId,p.keyFingerprint,p.storeName,p.customerName].every(value => typeof value === 'string' && value.length > 0 && value.length < 300) ||
      ![p.issuedAt,p.expiresAt].every(Number.isSafeInteger) || p.expiresAt <= p.issuedAt ||
      !Array.isArray(p.entitlements) || p.entitlements.some(cap => !['app.use','backup.upload','backup.restore','shop.view'].includes(cap))) throw Error('بيانات التصريح غير صالحة');
  if (p.accountId !== identity.accountId || p.installationId !== identity.id || p.keyFingerprint !== await fingerprint(identity.publicJwk)) throw Error('التصريح مخصص لتثبيت آخر');
  const jwk = keys?.[envelope.kid];
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d) throw Error('مفتاح التحقق غير معروف');
  const signature = decode64(envelope.signature);
  if (signature.length !== 64) throw Error('توقيع التصريح غير صالح');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, permitMessage(envelope))) throw Error('توقيع التصريح غير صالح');
  return { payload: p, expired: now >= p.expiresAt, canWrite: now >= p.issuedAt - 120000 && now < p.expiresAt && p.entitlements.includes('app.use') };
}
