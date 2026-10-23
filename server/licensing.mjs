import { randomUUID, sign, createPrivateKey } from 'node:crypto';
import { canonical, fingerprint, permitMessage, decode64 } from '../shared/permit.mjs';
import { token } from './security.mjs';
import { requireValue } from './store.mjs';
export const defaultPolicy={heartbeatMs:60000,leaseMs:300000,overlapGraceMs:300000,activationsPerDay:3};
export class Licensing {
  /** @param {import('./store.mjs').ServiceStore} store @param {{privateJwk:import('node:crypto').JsonWebKey,kid:string,publicKeys:Record<string,JsonWebKey>,policy?:Partial<typeof defaultPolicy>}} options */
  constructor(store,{privateJwk,kid,publicKeys,policy={}}){
    this.store=store;this.key=createPrivateKey({key:privateJwk,format:'jwk'});this.kid=kid;this.publicKeys=publicKeys;this.policy={...defaultPolicy,...policy};
    requireValue(typeof kid==='string'&&kid.length>0&&!!publicKeys[kid]&&Object.values(publicKeys).every(key=>key.kty==='EC'&&key.crv==='P-256'&&!key.d),'Only public verification keys may be published');
    for(const value of Object.values(this.policy))requireValue(Number.isSafeInteger(value)&&value>0,'Invalid installation policy');
  }
  /** @param {{account_id:string,token_hash:string}} session @param {{licenseId:string,installationId:string,publicJwk:JsonWebKey,purpose?:string,context?:string}} input @param {number} now */
  async challenge(session,{licenseId,installationId,publicJwk,purpose='activate',context=''},now=Date.now()){
    requireValue(['activate','presence','backup'].includes(purpose)&&typeof installationId==='string'&&/^[a-zA-Z0-9-]{10,100}$/.test(installationId),'Invalid installation');
    requireValue(purpose!=='backup'||/^[a-f0-9]{64}$/.test(context),'Backup request digest required');
    const license=this.store.scope(licenseId,session.account_id);requireValue(license,'Unavailable license',403);
    requireValue(publicJwk&&publicJwk.kty==='EC'&&publicJwk.crv==='P-256'&&!publicJwk.d&&/^[A-Za-z0-9_-]{43}$/.test(publicJwk.x||'')&&/^[A-Za-z0-9_-]{43}$/.test(publicJwk.y||''),'Invalid installation public key');
    // Import validates that this is an actual curve point, not merely a shaped JSON value.
    await crypto.subtle.importKey('jwk',publicJwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    const existing=this.store.get('SELECT * FROM installations WHERE id=?',installationId),fp=await fingerprint(publicJwk);
    requireValue(!existing||existing.account_id===session.account_id&&existing.license_id===licenseId&&existing.fingerprint===fp,'Unavailable installation',403);
    if(purpose==='activate')requireValue(license.kind==='app'&&license.status==='approved'&&(license.starts_at===null||license.starts_at<=now)&&(license.ends_at===null||license.ends_at>now),'License not active',403);
    else requireValue(existing&&existing.status==='approved','Installation observation unavailable',403);
    this.store.atomic(()=>this.store.limit('challenge:'+session.account_id,30,60000,now));
    const id=randomUUID(),message=canonical({id,nonce:token(),session:session.token_hash,account:session.account_id,licenseId,installationId,purpose,context,expiresAt:now+120000});
    this.store.run('INSERT INTO challenges VALUES(?,?,?,?,?,?,?,?,?,NULL)',id,session.account_id,session.token_hash,purpose,licenseId,installationId,JSON.stringify(publicJwk),message,now+120000);
    this.store.run('DELETE FROM challenges WHERE expires_at<?',now-86400000);
    return {id,message,expiresAt:now+120000};
  }
  /** @param {{account_id:string,token_hash:string}} session @param {{challengeId:string,signature:string}} input @param {string} purpose @param {number} now */
  async prove(session,{challengeId,signature},purpose,now=Date.now()){
    const row=this.store.get('SELECT * FROM challenges WHERE id=?',challengeId);
    requireValue(row&&row.account_id===session.account_id&&row.session_hash===session.token_hash&&row.purpose===purpose&&row.expires_at>now&&row.consumed_at===null,'Challenge expired or unavailable',403);
    const jwk=JSON.parse(row.public_jwk),key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    requireValue(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decode64(signature),new TextEncoder().encode(row.message)),'Invalid key proof',403);
    return {...row,fingerprint:await fingerprint(jwk)};
  }
  /** @param {any} row @param {{account_id:string,token_hash:string}} session @param {number} now */
  consume(row,session,now){
    requireValue(this.store.run('UPDATE challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? AND session_hash=?',now,row.id,now,session.token_hash).changes===1,'Challenge already used',409);
    requireValue(this.store.get('SELECT id FROM accounts WHERE id=? AND disabled=0',session.account_id),'Account disabled',403);
  }
  /** @param {any} license @param {any} installation @param {number} now */
  permit(license,installation,now){
    const end=Math.min(license.ends_at,license.offline_ms?now+license.offline_ms:license.ends_at);
    requireValue(end>now,'License expired',403);
    const envelope={schema:'contaonline-permit',version:1,kid:this.kid,payload:{accountId:license.account_id,shopId:license.shop_id,licenseId:license.id,installationId:installation.id,keyFingerprint:installation.fingerprint,storeName:license.store_name,customerName:license.customer_name,issuedAt:now,expiresAt:end,entitlements:['app.use','shop.view']},signature:''};
    envelope.signature=sign('sha256',permitMessage(envelope),{key:this.key,dsaEncoding:'ieee-p1363'}).toString('base64url');
    return envelope;
  }
  /** @param {{account_id:string,token_hash:string}} session @param {{challengeId:string,signature:string}} input @param {number} now */
  async enroll(session,input,now=Date.now()){
    const proof=await this.prove(session,input,'activate',now);
    return this.store.atomic(()=>{
      this.consume(proof,session,now);
      let license=this.store.scope(proof.license_id,session.account_id);requireValue(license&&license.kind==='app'&&license.status==='approved'&&(license.starts_at===null||license.starts_at<=now)&&(license.ends_at===null||license.ends_at>now),'License not active',403);
      let installation=this.store.get('SELECT * FROM installations WHERE id=?',proof.installation_id);
      requireValue(!installation||installation.account_id===session.account_id&&installation.license_id===license.id&&installation.fingerprint===proof.fingerprint,'Unavailable installation',403);
      requireValue(!installation||!['rejected','suspended','revoked'].includes(installation.status),'Installation requires administrative review',403);
      if(installation?.status==='pending-conflict'){this.store.audit(session.account_id,'installation.pending-retry',installation.id,'Existing activity conflict awaits administrative review','',{},now);return {pending:true};}
      if(installation?.status==='approved'&&license.writer_id&&license.writer_id!==installation.id){
        this.store.audit(session.account_id,'installation.superseded-return',installation.id,'Known prior installation requested a new permit; observation remains allowed','',{},now);
        return {pending:true,superseded:true};
      }
      const conflict=this.store.get('SELECT i.id FROM installations i JOIN presence p ON p.installation_id=i.id WHERE i.license_id=? AND i.id<>? AND i.status=? AND p.lease_until>? LIMIT 1',license.id,proof.installation_id,'approved',now);
      if(!installation){
        this.store.run('INSERT INTO installations(id,account_id,license_id,fingerprint,public_jwk,status,first_at) VALUES(?,?,?,?,?,?,?)',proof.installation_id,session.account_id,license.id,proof.fingerprint,proof.public_jwk,conflict?'pending-conflict':'approved',now);
        installation=this.store.get('SELECT * FROM installations WHERE id=?',proof.installation_id);
      }
      if(conflict&&license.writer_id!==installation.id){
        this.store.run('UPDATE installations SET status=? WHERE id=?','pending-conflict',installation.id);
        this.store.audit(session.account_id,'installation.pending',installation.id,'Recent conflicting connected activity','',{},now);
        return {pending:true};
      }
      if(license.writer_id!==installation.id){
        this.store.limit('activation:'+session.account_id,this.policy.activationsPerDay,86400000,now);
        this.store.run('UPDATE licenses SET writer_id=?,generation=generation+1,starts_at=COALESCE(starts_at,?),ends_at=COALESCE(ends_at,?+duration_ms) WHERE id=?',installation.id,now,now,license.id);
      }
      this.store.run('UPDATE installations SET last_activation_at=?,last_seen_at=? WHERE id=?',now,now,installation.id);
      this.store.run('INSERT INTO presence(installation_id,last_at,lease_until) VALUES(?,?,?) ON CONFLICT(installation_id) DO UPDATE SET last_at=excluded.last_at,lease_until=excluded.lease_until',installation.id,now,now+this.policy.leaseMs);
      license=this.store.scope(license.id,session.account_id);
      const permit=this.permit(license,installation,now);
      this.store.audit(session.account_id,'installation.approved',installation.id,'Successful installation key proof','',{generation:license.generation},now);
      return {pending:false,permit,keys:this.publicKeys,generation:license.generation,serverTime:now};
    });
  }
  /** Known-key channels authenticate only by proof; they never mint a service session or app permit.
   * @param {{licenseId:string,installationId:string,context?:string}} input @param {'observe'|'backup'} purpose @param {number} now */
  knownChallenge({licenseId,installationId,context=''},purpose,now=Date.now()){
    const i=this.store.get('SELECT * FROM installations WHERE id=? AND license_id=?',installationId,licenseId);requireValue(i,'Unavailable installation',403);
    const a=this.store.get('SELECT * FROM accounts WHERE id=?',i.account_id),l=this.store.scope(licenseId,i.account_id);requireValue(a&&l,'Unavailable installation',403);
    if(purpose==='backup')requireValue(a.role==='customer'&&!a.disabled&&i.status==='approved'&&l.status==='approved'&&l.writer_id===i.id&&/^[a-f0-9]{64}$/.test(context),'Approved current writer required',403);
    this.store.atomic(()=>this.store.limit('known-challenge:'+i.id,30,60000,now));
    const id=randomUUID(),marker='installation:'+i.id,message=canonical({id,nonce:token(),account:i.account_id,licenseId,installationId,purpose,context,expiresAt:now+120000});
    this.store.run('INSERT INTO challenges VALUES(?,?,?,?,?,?,?,?,?,NULL)',id,i.account_id,marker,purpose,licenseId,i.id,i.public_jwk,message,now+120000);this.store.run('DELETE FROM challenges WHERE expires_at<?',now-86400000);return {id,message,expiresAt:now+120000};
  }
  /** @param {string} challengeId @param {string} purpose @param {number} now */
  keySession(challengeId,purpose,now=Date.now()){
    const c=this.store.get('SELECT * FROM challenges WHERE id=?',challengeId);requireValue(c&&c.purpose===purpose&&c.session_hash==='installation:'+c.installation_id&&c.expires_at>now&&c.consumed_at===null,'Unavailable key challenge',403);
    const a=this.store.get('SELECT role FROM accounts WHERE id=?',c.account_id);requireValue(a,'Unavailable account',403);return {account_id:String(c.account_id),token_hash:String(c.session_hash),role:String(a.role)};
  }
  /** @param {{challengeId:string,signature:string}} input @param {number} now */
  async observe(input,now=Date.now()){return this.heartbeat(this.keySession(input.challengeId,'observe',now),input,now,true);}
  /** @param {{account_id:string,token_hash:string}} session @param {{challengeId:string,signature:string}} input @param {number} now @param {boolean} knownKey */
  async heartbeat(session,input,now=Date.now(),knownKey=false){
    const proof=await this.prove(session,input,knownKey?'observe':'presence',now);
    return this.store.atomic(()=>{
      if(knownKey)requireValue(this.store.run('UPDATE challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? AND session_hash=?',now,proof.id,now,session.token_hash).changes===1,'Challenge already used',409);else this.consume(proof,session,now);
      const installation=this.store.get('SELECT * FROM installations WHERE id=?',proof.installation_id),license=this.store.scope(proof.license_id,session.account_id);
      const account=this.store.get('SELECT disabled FROM accounts WHERE id=?',session.account_id);
      if(knownKey&&(account.disabled||installation.status!=='approved'||license.status!=='approved'))return {serverTime:now,accountStatus:account.disabled?'disabled':'active',licenseStatus:license.status,installationStatus:installation.status,writer:false,overlap:false,reviewRequired:false,generation:license.generation};
      requireValue(installation?.status==='approved'&&license,'Observation unavailable',403);
      const previous=this.store.get('SELECT * FROM presence WHERE installation_id=?',installation.id);
      const others=this.store.all('SELECT p.* FROM presence p JOIN installations i ON i.id=p.installation_id WHERE i.license_id=? AND i.id<>? AND i.status=? AND p.lease_until>?',license.id,installation.id,'approved',now);
      // A stale return never inherits an old overlap window. Both peers must continue proving presence.
      const since=others.length?(previous?.lease_until>now&&previous.overlap_since?previous.overlap_since:now):null;
      this.store.run('INSERT INTO presence VALUES(?,?,?,?,?) ON CONFLICT(installation_id) DO UPDATE SET last_at=excluded.last_at,lease_until=excluded.lease_until,overlap_since=excluded.overlap_since,overlap_last=excluded.overlap_last',installation.id,now,now+this.policy.leaseMs,since,others.length?now:null);
      let overlap=false;
      if(since&&now-since>=this.policy.overlapGraceMs&&others.some(peer=>peer.overlap_since&&now-peer.overlap_since>=this.policy.overlapGraceMs&&peer.last_at>=now-this.policy.heartbeatMs*2)){
        overlap=true;
        const inserted=this.store.run('INSERT OR IGNORE INTO incidents VALUES(?,?,?, ?,NULL)',randomUUID(),license.id,'connected-overlap',now);
        if(inserted.changes)this.store.audit(session.account_id,'presence.overlap',license.id,'Repeated connected overlap after grace','',{},now);
      }
      this.store.run('UPDATE installations SET last_seen_at=? WHERE id=?',now,installation.id);
      return {serverTime:now,accountStatus:'active',overlap,reviewRequired:overlap,licenseStatus:license.status,installationStatus:installation.status,writer:license.writer_id===installation.id&&license.status==='approved'&&license.ends_at>now,generation:license.generation};
    });
  }
  /** @param {{account_id:string}} session @param {string} licenseId @param {string} installationId @param {number} generation @param {number} now */
  authorizeUpload(session,licenseId,installationId,generation,now=Date.now()){
    const l=this.store.scope(licenseId,session.account_id),i=this.store.get('SELECT * FROM installations WHERE id=? AND account_id=?',installationId,session.account_id);
    // Upload authority is independent of app expiry; callers must check the separate backup entitlement.
    requireValue(l&&i&&i.license_id===l.id&&i.status==='approved'&&l.status==='approved'&&l.writer_id===i.id&&l.generation===generation,'Writer authority unavailable',403);
    requireValue(!this.store.get('SELECT id FROM incidents WHERE license_id=? AND resolved_at IS NULL',l.id),'Writer authority suspended for review',409);
    return l;
  }
  /** @param {string} actor @param {{installationId:string,action:'allow'|'reject'|'suspend'|'resume'|'revoke',reason:string,paymentReference?:string}} input @param {number} now */
  moderate(actor,{installationId,action,reason,paymentReference=''},now=Date.now()){
    requireValue(['allow','reject','suspend','resume','revoke'].includes(action),'Invalid decision');
    return this.store.atomic(()=>{
      const i=this.store.get('SELECT * FROM installations WHERE id=?',installationId);requireValue(i,'Unavailable installation');
      const l=this.store.get('SELECT * FROM licenses WHERE id=?',i.license_id);requireValue(action!=='allow'||l.status==='approved'&&l.ends_at>now,'License must be valid');
      const status={allow:'approved',reject:'rejected',suspend:'suspended',resume:'approved',revoke:'revoked'}[action];
      this.store.run('UPDATE installations SET status=? WHERE id=?',status,i.id);
      if(action==='allow')this.store.run('UPDATE licenses SET writer_id=?,generation=generation+1 WHERE id=?',i.id,l.id);
      if(action==='reject'||action==='revoke'||action==='suspend')this.store.run('DELETE FROM presence WHERE installation_id=?',i.id);
      if(action==='allow'||action==='resume')this.store.run('UPDATE incidents SET resolved_at=? WHERE license_id=? AND resolved_at IS NULL',now,l.id);
      this.store.audit(actor,'installation.'+action,i.id,reason,paymentReference,{},now);return {status};
    });
  }
}
