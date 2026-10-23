import cookie from '@fastify/cookie';
import { randomUUID, createHmac } from 'node:crypto';
import { passwordHash, passwordMatches, token, digest, decrypt, verifyOtp } from './security.mjs';
import { requireValue } from './store.mjs';
import { canonical } from '../shared/permit.mjs';
const string={type:'string',minLength:1,maxLength:300},reason={type:'string',minLength:3,maxLength:1000},integer={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
/** @param {Record<string,object>} properties @param {string[]} required */
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
/** @param {import('fastify').FastifyInstance} app @param {{store:import('./store.mjs').ServiceStore,licensing:import('./licensing.mjs').Licensing,encryptionKey:Buffer,backups?:import('./backups.mjs').Backups,secureCookies?:boolean,now?:()=>number}} options */
export async function registerServiceApi(app,{store,licensing,encryptionKey,backups,secureCookies=true,now=()=>Date.now()}){
  await app.register(cookie);
  const dummy=await passwordHash(token());
  /** @param {string} sessionHash */
  const csrfFor=sessionHash=>createHmac('sha256',encryptionKey).update('csrf:'+sessionHash).digest('base64url');
  /** @param {import('fastify').FastifyRequest} request @param {boolean} write @param {boolean} owner */
  function session(request,write=false,owner=false){
    const row=store.get('SELECT s.*,a.role,a.disabled,a.credential_version AS current_version FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=?',digest(request.cookies.co_session||''));
    requireValue(row&&!row.disabled&&row.expires_at>now()&&row.credential_version===row.current_version,'Authentication required',401);
    requireValue(row.role==='customer'||row.mfa===1,'MFA required',403);
    if(write)requireValue(typeof request.headers['x-csrf-token']==='string'&&digest(request.headers['x-csrf-token'])===row.csrf_hash,'CSRF check failed',403);
    if(owner)requireValue(row.role==='owner','Owner permission required',403);
    return row;
  }
  // Body fields are runtime-validated by the closed JSON schemas at this boundary.
  /** @typedef {Omit<import('fastify').FastifyRequest,'body'> & {body:any}} BodyRequest */
  /** @param {string} url @param {object} schema @param {(request:BodyRequest,reply:import('fastify').FastifyReply)=>Promise<any>} handler */
  const post=(url,schema,handler)=>app.post(url,{schema:{body:schema}},(request,reply)=>handler(/** @type {BodyRequest} */(request),reply));
  post('/api/session/login',object({username:string,password:{type:'string',minLength:1,maxLength:256},otp:{type:'string',maxLength:6}},['username','password']),async(request,reply)=>{
    const body=request.body,key='login:'+digest(request.ip+':'+body.username.toLowerCase());
    store.atomic(()=>{store.limit(key,8,900000,now());store.limit('login-ip:'+digest(request.ip),100,900000,now());});
    const account=store.get('SELECT * FROM accounts WHERE username=?',body.username.trim().toLowerCase());
    const valid=await passwordMatches(body.password,account?.password_hash||dummy);let step=null;
    if(account&&account.role!=='customer'&&account.totp_encrypted)step=verifyOtp(Buffer.from(decrypt(account.totp_encrypted,encryptionKey),'base64url'),body.otp,now(),account.last_totp_step);
    requireValue(valid&&account&&!account.disabled&&(account.role==='customer'||step!==null),'Invalid credentials or MFA',401);
    const secret=token(),csrf=csrfFor(digest(secret)),expiresAt=now()+8*3600000;
    store.atomic(()=>{
      if(step!==null)requireValue(store.run('UPDATE accounts SET last_totp_step=? WHERE id=? AND last_totp_step<?',step,account.id,step).changes===1,'MFA already used',401);
      store.run('INSERT INTO sessions VALUES(?,?,?,?,?,?)',digest(secret),account.id,digest(csrf),account.credential_version,expiresAt,account.role==='customer'?0:1);
      store.run('DELETE FROM sessions WHERE expires_at<?',now());
    });
    reply.setCookie('co_session',secret,{httpOnly:true,secure:secureCookies,sameSite:'strict',path:'/',maxAge:8*3600});
    return {account:{id:account.id,role:account.role},csrfToken:csrf,expiresAt,licenses:store.all('SELECT l.id,l.kind,s.name AS storeName FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=? AND l.status=?',account.id,'approved')};
  });
  app.get('/api/session',async request=>{const s=session(request);return {account:{id:s.account_id,role:s.role},expiresAt:s.expires_at};});
  app.get('/api/session/resume',async request=>{requireValue(request.headers['x-session-resume']==='1','Same-origin application request required',403);const s=session(request);return {account:{id:s.account_id,role:s.role},csrfToken:csrfFor(s.token_hash),expiresAt:s.expires_at};});
  post('/api/session/logout',object({}),async(request,reply)=>{const s=session(request,true);store.run('DELETE FROM sessions WHERE token_hash=?',s.token_hash);reply.clearCookie('co_session',{path:'/'});return {ok:true};});
  post('/api/session/password',object({currentPassword:string,newPassword:{type:'string',minLength:12,maxLength:256}}),async request=>{
    const s=session(request,true),a=store.get('SELECT * FROM accounts WHERE id=?',s.account_id);requireValue(await passwordMatches(request.body.currentPassword,a.password_hash),'Invalid credentials',401);
    const hash=await passwordHash(request.body.newPassword);store.atomic(()=>{store.run('UPDATE accounts SET password_hash=?,credential_version=credential_version+1 WHERE id=?',hash,a.id);store.run('DELETE FROM sessions WHERE account_id=?',a.id);store.audit(a.id,'account.password',a.id,'User changed service password');});return {ok:true,loginRequired:true};
  });
  app.get('/api/activation/keys',async request=>{session(request);return {keys:licensing.publicKeys};});
  post('/api/activation/status',object({licenseId:string,installationId:string}),async request=>{const s=session(request,true),b=request.body,l=store.scope(b.licenseId,s.account_id),i=store.get('SELECT * FROM installations WHERE id=? AND account_id=? AND license_id=?',b.installationId,s.account_id,b.licenseId);requireValue(l&&i,'Unavailable installation',403);return {serverTime:now(),licenseStatus:l.status,installationStatus:i.status,endsAt:l.ends_at,writer:l.writer_id===i.id,generation:l.generation};});
  post('/api/activation/challenge',object({licenseId:string,installationId:string,publicJwk:{type:'object'},purpose:{enum:['activate','presence','backup']},context:{type:'string',pattern:'^[a-f0-9]{64}$'}},['licenseId','installationId','publicJwk']),async request=>licensing.challenge(session(request,true),request.body,now()));
  /** @type {Array<[string,'enroll'|'heartbeat']>} */
  const proofRoutes=[['/api/activation/enroll','enroll'],['/api/activity/heartbeat','heartbeat']];
  for(const [url,method]of proofRoutes)post(url,object({challengeId:string,signature:string}),async request=>{
    const s=session(request,true);store.atomic(()=>store.limit('proof:'+s.account_id,60,60000,now()));return licensing[method](s,request.body,now());
  });
  post('/api/activity/challenge',object({licenseId:string,installationId:string}),async request=>licensing.knownChallenge(request.body,'observe',now()));
  post('/api/activity/observe',object({challengeId:string,signature:string}),async request=>{const s=licensing.keySession(request.body.challengeId,'observe',now());store.atomic(()=>store.limit('observation-proof:'+s.account_id,60,60000,now()));return licensing.observe(request.body,now());});
  app.get('/api/admin/overview',async request=>{
    const s=session(request);requireValue(['owner','support'].includes(s.role),'Administrative permission required',403);
    return {accounts:store.all('SELECT id,username,role,disabled,created_at FROM accounts ORDER BY created_at DESC LIMIT 500'),shops:store.all('SELECT * FROM shops LIMIT 500'),plans:store.all('SELECT * FROM plans LIMIT 500'),licenses:store.all('SELECT * FROM licenses LIMIT 500'),installations:store.all('SELECT id,account_id,license_id,status,first_at,last_seen_at,last_activation_at FROM installations LIMIT 500'),incidents:store.all('SELECT * FROM incidents ORDER BY opened_at DESC LIMIT 500'),payments:s.role==='owner'?store.all('SELECT * FROM payments ORDER BY created_at DESC LIMIT 500'):[],audit:store.all('SELECT * FROM audit ORDER BY id DESC LIMIT 200')};
  });
  post('/api/admin/search',object({query:{type:'string',maxLength:200},cursor:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:100}}),async request=>{
    const s=session(request,true),b=request.body;requireValue(['owner','support'].includes(s.role),'Administrative permission required',403);
    const where='(?=\'\' OR instr(lower(a.username),lower(?))>0 OR EXISTS(SELECT 1 FROM shops s WHERE s.account_id=a.id AND (instr(lower(s.name),lower(?))>0 OR instr(lower(s.customer_name),lower(?))>0)))';
    const args=[b.query,b.query,b.query,b.query],accounts=store.all('SELECT a.id,a.username,a.role,a.disabled,a.created_at FROM accounts a WHERE '+where+' ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?',...args,b.limit,b.cursor),total=store.get('SELECT COUNT(*) AS count FROM accounts a WHERE '+where,...args).count;
    const ids=accounts.map(row=>row.id),slots=ids.map(()=>'?').join(',')||'NULL';
    const backupStatus=backups?store.all("SELECT c.shop_id AS id,s.name AS shop,l.ends_at AS serviceEndsAt,c.enabled,30 AS retentionDays,COALESCE(SUM(CASE WHEN v.status<>'deleted' THEN v.bytes ELSE 0 END),0) AS bytes,MAX(v.created_at) AS lastSuccessAt,(SELECT MAX(at) FROM audit WHERE action='backup.failure' AND actor_id=c.account_id) AS lastFailureAt FROM backup_consents c JOIN shops s ON s.id=c.shop_id JOIN licenses l ON l.id=c.backup_license_id LEFT JOIN backup_versions v ON v.shop_id=c.shop_id WHERE c.account_id IN ("+slots+") GROUP BY c.shop_id",...ids):[];
    return {nextCursor:b.cursor+accounts.length<total?b.cursor+accounts.length:null,total,data:{accounts,backupStatus,shops:store.all('SELECT * FROM shops WHERE account_id IN ('+slots+')',...ids),plans:store.all('SELECT * FROM plans ORDER BY name LIMIT 500'),licenses:store.all('SELECT l.* FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id IN ('+slots+')',...ids),installations:store.all('SELECT id,account_id,license_id,status,first_at,last_seen_at,last_activation_at FROM installations WHERE account_id IN ('+slots+')',...ids),incidents:store.all('SELECT * FROM incidents ORDER BY opened_at DESC LIMIT 200'),payments:s.role==='owner'?store.all('SELECT * FROM payments ORDER BY created_at DESC LIMIT 200'):[],audit:store.all('SELECT * FROM audit ORDER BY id DESC LIMIT 200')}};
  });
  post('/api/admin/accounts',object({username:string,customerName:string,storeName:string,reason}),async request=>{
    const s=session(request,true,true),b=request.body,secret=token(),hash=await passwordHash(secret),id=randomUUID(),shopId=randomUUID();
    store.atomic(()=>{store.run('INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)',id,b.username.trim().toLowerCase(),hash,'customer',now());store.run('INSERT INTO shops VALUES(?,?,?,?)',shopId,id,b.storeName,b.customerName);store.audit(s.account_id,'account.create',id,b.reason,'',{shopId},now());});
    return {id,shopId,initialPassword:secret,notice:'Shown once. Deliver privately; customer should change it. Never put in a URL.'};
  });
  post('/api/admin/edit-customer',object({accountId:string,username:string,customerName:string,storeName:string,reason}),async request=>{
    const s=session(request,true,true),b=request.body;
    store.atomic(()=>{const a=store.get('SELECT id FROM accounts WHERE id=? AND role=?',b.accountId,'customer');requireValue(a,'Customer account required');store.run('UPDATE accounts SET username=? WHERE id=?',b.username.trim().toLowerCase(),a.id);store.run('UPDATE shops SET name=?,customer_name=? WHERE account_id=?',b.storeName,b.customerName,a.id);store.audit(s.account_id,'customer.edit',a.id,b.reason,'',{},now());});return {ok:true};
  });
  post('/api/admin/account-status',object({accountId:string,disabled:{type:'boolean'},reason}),async request=>{const s=session(request,true,true),b=request.body;requireValue(b.accountId!==s.account_id,'Cannot disable your own administrative account');store.atomic(()=>{requireValue(store.run('UPDATE accounts SET disabled=?,credential_version=credential_version+1 WHERE id=?',Number(b.disabled),b.accountId).changes===1,'Unknown account');store.run('DELETE FROM sessions WHERE account_id=?',b.accountId);store.audit(s.account_id,'account.status',b.accountId,b.reason,'',{disabled:b.disabled},now());});return {ok:true};});
  post('/api/admin/reset-access',object({accountId:string,reason}),async request=>{const s=session(request,true,true),b=request.body,a=store.get('SELECT * FROM accounts WHERE id=?',b.accountId);requireValue(a?.role==='customer','Customer account required');const secret=token(),hash=await passwordHash(secret);store.atomic(()=>{store.run('UPDATE accounts SET password_hash=?,credential_version=credential_version+1 WHERE id=?',hash,a.id);store.run('DELETE FROM sessions WHERE account_id=?',a.id);store.audit(s.account_id,'account.reset',a.id,b.reason,'',{},now());});return {initialPassword:secret};});
  post('/api/admin/plans',object({name:string,kind:{enum:['app','backup']},durationMs:{type:'integer',minimum:60000,maximum:10*366*86400000},priceMinor:integer,currency:{type:'string',pattern:'^[A-Z]{3}$'},offlineMs:{anyOf:[{type:'integer',minimum:60000},{type:'null'}]},reason}),async request=>{
    const s=session(request,true,true),b=request.body,id=randomUUID();store.atomic(()=>{store.run('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)',id,b.name,b.kind,b.durationMs,b.priceMinor,b.currency,b.offlineMs);store.audit(s.account_id,'plan.create',id,b.reason,'',{},now());});return {id};
  });
  post('/api/admin/edit-plan',object({planId:string,name:string,durationMs:{type:'integer',minimum:60000,maximum:10*366*86400000},priceMinor:integer,currency:{type:'string',pattern:'^[A-Z]{3}$'},offlineMs:{anyOf:[{type:'integer',minimum:60000},{type:'null'}]},enabled:{type:'boolean'},reason}),async request=>{
    const s=session(request,true,true),b=request.body;store.atomic(()=>{requireValue(store.run('UPDATE plans SET name=?,duration_ms=?,price_minor=?,currency=?,offline_ms=?,enabled=? WHERE id=?',b.name,b.durationMs,b.priceMinor,b.currency,b.offlineMs,Number(b.enabled),b.planId).changes===1,'Unknown plan');store.audit(s.account_id,'plan.edit',b.planId,b.reason,'',{existingIssuedTermsUnchanged:true},now());});return {ok:true};
  });
  post('/api/admin/licenses',object({shopId:string,planId:string,reason,paymentReference:string,explicitStart:{anyOf:[integer,{type:'null'}]}},['shopId','planId','reason','paymentReference']),async request=>store.issueLicense(session(request,true,true).account_id,request.body,now()));
  post('/api/admin/renew',object({licenseId:string,durationMs:{type:'integer',minimum:60000,maximum:10*366*86400000},reason,paymentReference:string}),async request=>store.renew(session(request,true,true).account_id,request.body,now()));
  post('/api/admin/license-status',object({licenseId:string,status:{enum:['approved','suspended','blocked']},reason,paymentReference:string}),async request=>{const s=session(request,true,true),b=request.body;store.atomic(()=>{requireValue(store.run('UPDATE licenses SET status=? WHERE id=?',b.status,b.licenseId).changes===1,'Unknown license');store.audit(s.account_id,'license.status',b.licenseId,b.reason,b.paymentReference,{status:b.status},now());});return {ok:true};});
  post('/api/admin/payments',object({licenseId:string,amountMinor:integer,currency:{type:'string',pattern:'^[A-Z]{3}$'},paidAt:integer,reference:string,note:reason,reason}),async request=>{const s=session(request,true,true),b=request.body,id=randomUUID();store.atomic(()=>{store.run('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)',id,b.licenseId,b.amountMinor,b.currency,b.paidAt,b.reference,b.note,s.account_id,now());store.audit(s.account_id,'payment.record',id,b.reason,b.reference,{},now());});return {id};});
  post('/api/admin/installations',object({installationId:string,action:{enum:['allow','reject','suspend','resume','revoke']},reason,paymentReference:string}),async request=>licensing.moderate(session(request,true,true).account_id,request.body,now()));
  post('/api/admin/public-settings',object({apkEnabled:{type:'boolean'},apkUrl:{type:'string',maxLength:2048},apkVersion:{type:'string',maxLength:100},brandName:{type:'string',maxLength:120},supportPhone:{type:'string',pattern:'^(\\+?[0-9]{7,15})?$'},reason},['apkEnabled','apkUrl','apkVersion','reason']),async request=>{
    const s=session(request,true,true),b=request.body;
    if(b.apkEnabled){const url=new URL(b.apkUrl);requireValue(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&!!b.apkVersion,'A verified HTTPS APK URL and version are required');}
    const config={brandName:b.brandName||'الكرنه',supportPhone:b.supportPhone||null,apk:{enabled:b.apkEnabled,url:b.apkEnabled?b.apkUrl:null,version:b.apkEnabled?b.apkVersion:null}};
    store.atomic(()=>{store.run('INSERT INTO settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value','public',JSON.stringify(config));store.audit(s.account_id,'settings.public','public',b.reason,'',{},now());});return {ok:true};
  });
  if(backups){
    post('/api/backup/challenge',object({licenseId:string,installationId:string,context:{type:'string',pattern:'^[a-f0-9]{64}$'}}),async request=>licensing.knownChallenge(request.body,'backup',now()));
    post('/api/backup/status',object({appLicenseId:string}),async request=>{
      const s=session(request,true),l=store.scope(request.body.appLicenseId,s.account_id);requireValue(s.role==='customer'&&l,'Unavailable shop',403);
      let versions=null;try{versions=backups.versions(s,l.shop_id,now());}catch{}
      return {retentionDays:30,licenses:store.all('SELECT id,status,starts_at AS startsAt,ends_at AS endsAt FROM licenses WHERE shop_id=? AND kind=?',l.shop_id,'backup'),consent:store.get('SELECT enabled,policy_version,notice_at FROM backup_consents WHERE shop_id=? AND account_id=?',l.shop_id,s.account_id)||null,versions,writer:l.writer_id,generation:l.generation};
    });
    post('/api/backup/consent',object({shopId:string,backupLicenseId:string,enabled:{type:'boolean'},policyVersion:{const:1}}),async request=>backups.consent(session(request,true),request.body,now()));
    app.post('/api/backup/dispatch',{bodyLimit:10*1024*1024,schema:{body:object({challengeId:string,signature:string,operation:{enum:['open','upload','download']},payload:{type:'object'}})}},async(request,reply)=>{
      const b=/** @type {any} */(request.body),challenge=store.get('SELECT session_hash FROM challenges WHERE id=?',b.challengeId),s=challenge?.session_hash.startsWith('installation:')?licensing.keySession(b.challengeId,'backup',now()):session(request,true);store.atomic(()=>store.limit('backup-upload:'+s.account_id,20,60000,now()));
      const proof=await licensing.prove(s,b,'backup',now());requireValue(JSON.parse(proof.message).context===digest(canonical({operation:b.operation,payload:b.payload})),'Backup proof does not match payload',403);
      if(b.operation==='open')requireValue(b.payload.appLicenseId===proof.license_id&&b.payload.installationId===proof.installation_id,'Backup installation mismatch',403);
      else if(b.operation==='upload'){const stream=store.get('SELECT * FROM backup_streams WHERE id=? AND account_id=?',b.payload.streamId,s.account_id);requireValue(stream&&stream.app_license_id===proof.license_id&&stream.installation_id===proof.installation_id,'Backup installation mismatch',403);}
      else{const version=store.get('SELECT v.id,s.app_license_id FROM backup_versions v JOIN backup_streams s ON s.id=v.stream_id WHERE v.id=? AND v.account_id=?',b.payload.versionId,s.account_id),license=store.scope(proof.license_id,s.account_id);requireValue(version&&version.app_license_id===proof.license_id&&license.writer_id===proof.installation_id,'Approved installation required to download backup content',403);}
      store.atomic(()=>licensing.consume(proof,s,now()));
      try{return b.operation==='open'?backups.openStream(s,b.payload,now()):b.operation==='upload'?backups.receive(s,b.payload,now()):backups.download(s,b.payload.versionId,now());}
      catch(error){try{store.audit(s.account_id,'backup.failure',s.account_id,'Authorized backup request failed','',{operation:b.operation,requestId:request.id},now());}catch{}throw error;}
    });
  }
}
