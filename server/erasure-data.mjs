import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, unlinkSync, rmdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { requireValue } from './store.mjs';
/** @param {string} accountId */
export const accountFolder=accountId=>createHash('sha256').update(accountId).digest('hex');
/** @param {import('./store.mjs').ServiceStore} store @param {string} table */
const exists=(store,table)=>!!store.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table);
/** Collect ownership before removing any rows. Never infer ownership from a customer name.
 * @param {import('./store.mjs').ServiceStore} store @param {string} accountId */
export function erasureScope(store,accountId){
  const account=store.get('SELECT * FROM accounts WHERE id=? AND role=?',accountId,'customer');
  requireValue(account,'Customer service account required',404);
  const shops=store.all('SELECT id,name FROM shops WHERE account_id=?',accountId),licenses=store.all('SELECT l.id FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=?',accountId),installations=store.all('SELECT id FROM installations WHERE account_id=?',accountId);
  const versions=exists(store,'backup_versions')?store.all('SELECT * FROM backup_versions WHERE account_id=?',accountId):[];
  const streams=exists(store,'backup_streams')?store.all('SELECT id FROM backup_streams WHERE account_id=?',accountId):[];
  const payments=store.all('SELECT p.id FROM payments p JOIN licenses l ON l.id=p.license_id JOIN shops s ON s.id=l.shop_id WHERE s.account_id=? OR p.actor_id=?',accountId,accountId);
  const requests=store.all('SELECT id FROM privacy_deletion_requests WHERE account_id=?',accountId);
  const ids=new Set([accountId,...[shops,licenses,installations,versions,streams,payments,requests].flat().map(row=>String(row.id))]);
  /** @param {unknown} value @returns {boolean} */
  const mentions=value=>typeof value==='string'?ids.has(value):Array.isArray(value)?value.some(mentions):!!value&&typeof value==='object'&&Object.values(value).some(mentions);
  const auditIds=store.all('SELECT id,actor_id,target_id,metadata FROM audit').filter(row=>ids.has(row.actor_id)||ids.has(row.target_id)||mentions(JSON.parse(row.metadata))).map(row=>row.id);
  return {accountId,username:account.username,shops,licenses,installations,versions,streams,payments,requests,auditIds,counts:{shops:shops.length,licenses:licenses.length,installations:installations.length,backups:versions.length,payments:payments.length,audit:auditIds.length}};
}
/** Scoped exception to append-only audit, only used by the verified erasure worker and restore filter.
 * @param {import('./store.mjs').ServiceStore} store @param {ReturnType<typeof erasureScope>} scope */
export function eraseRows(store,scope){
  const {accountId}=scope;
  store.db.exec('PRAGMA secure_delete=ON');
  store.atomic(()=>{
    // DDL is transactional: a failure also restores the audit guard and every deleted row.
    store.db.exec('DROP TRIGGER audit_no_delete');
    for(const id of scope.auditIds)store.run('DELETE FROM audit WHERE id=?',id);
    store.db.exec("CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append only');END");
    for(const row of scope.installations)store.run('DELETE FROM presence WHERE installation_id=?',row.id);
    for(const row of scope.licenses)store.run('DELETE FROM incidents WHERE license_id=?',row.id);
    for(const row of scope.streams)store.run('DELETE FROM backup_events WHERE stream_id=?',row.id);
    for(const table of ['backup_versions','backup_streams','backup_consents','privacy_erasure_previews','privacy_owner_credentials','privacy_deletion_requests','recovery_codes','sessions','challenges','installations'])if(exists(store,table))store.run('DELETE FROM '+table+' WHERE account_id=?',accountId);
    for(const row of scope.payments)store.run('DELETE FROM payments WHERE id=?',row.id);
    for(const row of scope.licenses)store.run('DELETE FROM licenses WHERE id=?',row.id);
    store.run('DELETE FROM shops WHERE account_id=?',accountId);store.run('DELETE FROM accounts WHERE id=?',accountId);
    // These keys contain internal account/installation IDs, never shared IP-only buckets.
    for(const row of store.all('SELECT key FROM limits'))if([accountId,accountFolder(scope.username),...scope.installations.map(i=>i.id)].some(id=>row.key.endsWith(':'+id)))store.run('DELETE FROM limits WHERE key=?',row.key);
  });
}
/** Remove only owned regular files; refuse links, escapes and unexpected directory contents.
 * @param {string} root @param {string} accountId @param {string[]} files */
export function eraseFiles(root,accountId,files){
  const base=path.resolve(root),owned=path.join(base,accountFolder(accountId));
  const baseReal=realpathSync(base);
  /** @param {string} filename */
  function remove(filename){
    const resolved=path.resolve(filename);requireValue(resolved.startsWith(base+path.sep),'Unsafe erasure path',500);
    try{const entry=lstatSync(resolved);requireValue(entry.isFile()&&!entry.isSymbolicLink()&&entry.nlink===1&&[baseReal,owned].includes(realpathSync(path.dirname(resolved))),'Unsafe erasure file',500);unlinkSync(resolved);}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='ENOENT')throw error;}
  }
  for(const filename of files){const resolved=path.resolve(filename);requireValue(path.dirname(resolved)===base&&/^[a-f0-9-]{36}\.json$/.test(path.basename(resolved))||path.dirname(resolved)===owned,'Unrecognized owned backup path',500);remove(resolved);}
  try{const entry=lstatSync(owned);requireValue(entry.isDirectory()&&!entry.isSymbolicLink()&&realpathSync(owned)===owned,'Unsafe account backup directory',500);for(const name of readdirSync(owned)){requireValue(/^[a-f0-9-]{36}\.json$/.test(name),'Unrecognized account backup file',500);remove(path.join(owned,name));}rmdirSync(owned);}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='ENOENT')throw error;}
}
/** Scrub SQLite free pages and the current WAL; not a claim of physical media sanitization.
 * @param {import('./store.mjs').ServiceStore} store */
export function compactAfterErasure(store){
  const checkpoint=()=>requireValue(store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy===0,'Database reader prevents erasure checkpoint; retry',503);
  checkpoint();store.db.exec('VACUUM');checkpoint();
}
/** Legacy flat crash-orphans have no reliable ownership. Never silently declare them erased.
 * @param {import('./store.mjs').ServiceStore} store @param {string} root */
export function checkLegacyOrphans(store,root){
  const known=new Set(store.all('SELECT path FROM backup_versions').map(row=>path.resolve(row.path)));
  for(const name of readdirSync(root)){const resolved=path.join(path.resolve(root),name),entry=lstatSync(resolved);requireValue(!entry.isSymbolicLink(),'Unexpected link in private backup storage',500);if(entry.isFile()&&!known.has(resolved))throw Error('Unowned legacy backup requires private operator reconciliation');}
}
