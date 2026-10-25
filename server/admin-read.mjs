import { requireValue } from './store.mjs';
const DAY=86400000;
// Only customer accounts enter the directory. Secret/authentication and backup-content columns never enter this model.
const CUSTOMERS=`WITH customers AS (
 SELECT a.id,a.username,a.disabled,a.created_at,
 (SELECT name FROM shops WHERE account_id=a.id ORDER BY id LIMIT 1) AS name,
 (SELECT customer_name FROM shops WHERE account_id=a.id ORDER BY id LIMIT 1) AS customerName,
 (SELECT COUNT(*) FROM shops WHERE account_id=a.id) AS shopCount,
 (SELECT COUNT(*) FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=a.id AND l.kind='app') AS appCount,
 (SELECT COUNT(*) FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=a.id AND l.kind='app' AND l.status='approved' AND l.starts_at IS NOT NULL AND l.starts_at<=c.at AND l.ends_at>c.at) AS activeApps,
 (SELECT COUNT(*) FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=a.id AND l.kind='app' AND l.status='approved' AND l.ends_at<=c.at) AS expiredApps,
 (SELECT COUNT(*) FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=a.id AND l.kind='app' AND l.status<>'approved') AS restrictedApps,
 (SELECT MIN(l.ends_at) FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=a.id AND l.kind='app' AND l.status='approved' AND l.ends_at>c.at) AS nextEndAt,
 (SELECT COUNT(*) FROM installations WHERE account_id=a.id AND status='pending-conflict') AS pendingDevices,
 (SELECT MAX(last_seen_at) FROM installations WHERE account_id=a.id) AS lastActivityAt,
 (SELECT COUNT(*) FROM incidents i JOIN licenses l ON l.id=i.license_id JOIN shops s ON s.id=l.shop_id WHERE s.account_id=a.id AND i.resolved_at IS NULL) AS openIncidents,
 (SELECT MAX(at) FROM audit WHERE actor_id=a.id AND action='backup.failure') AS lastBackupFailureAt,
 (SELECT COUNT(*) FROM privacy_deletion_requests WHERE account_id=a.id AND status IN ('requested','in-review','needs-verification')) AS privacyRequests
 FROM accounts a CROSS JOIN (SELECT ? AS at) c WHERE a.role='customer'
) `;
/** Scoped metadata for payzone administration; no authority or subscription rules live here. */
export class AdminReadModel {
  /** @param {import('./store.mjs').ServiceStore} store @param {boolean} backups */
  constructor(store,backups){this.store=store;this.backups=backups;}
  /** @param {number} now */
  directorySql(now){
    const backup=this.backups?'(SELECT MAX(created_at) FROM backup_versions WHERE account_id=customers.id AND status=\'ready\')':'NULL';
    return {sql:CUSTOMERS+`, directory AS (SELECT *,${backup} AS lastBackupAt FROM customers), classified AS (SELECT *,CASE WHEN nextEndAt IS NOT NULL AND nextEndAt<=? THEN 1 ELSE 0 END AS expiring,CASE WHEN lastBackupFailureAt IS NOT NULL AND (lastBackupAt IS NULL OR lastBackupFailureAt>lastBackupAt) THEN 1 ELSE 0 END AS backupFailure FROM directory), flagged AS (SELECT *,CASE WHEN disabled=1 OR appCount=0 OR expiredApps>0 OR restrictedApps>0 OR pendingDevices>0 OR openIncidents>0 OR expiring=1 OR backupFailure=1 OR privacyRequests>0 THEN 1 ELSE 0 END AS attention FROM classified) `,args:[now,now+7*DAY]};
  }
  /** @param {{query:string,filter:string,cursor:number,limit:number}} input @param {number} now */
  search({query,filter,cursor,limit},now){
    const base=this.directorySql(now),filters={all:'1=1',attention:'attention=1',expiring:'expiring=1',devices:'pendingDevices>0 OR openIncidents>0',backups:'backupFailure=1',disabled:'disabled=1'};
    requireValue(Object.hasOwn(filters,filter),'Unknown customer filter');
    const condition=/** @type {Record<string,string>} */(filters)[filter];
    const where="WHERE ("+condition+") AND (?='' OR instr(lower(username),lower(?))>0 OR EXISTS(SELECT 1 FROM shops s WHERE s.account_id=flagged.id AND (instr(lower(s.name),lower(?))>0 OR instr(lower(s.customer_name),lower(?))>0)))";
    const args=[...base.args,query,query,query,query],total=this.store.get(base.sql+'SELECT COUNT(*) AS n FROM flagged '+where,...args).n;
    const customers=this.store.all(base.sql+'SELECT * FROM flagged '+where+' ORDER BY attention DESC,created_at DESC,id LIMIT ? OFFSET ?',...args,limit,cursor);
    const summary=this.store.get(base.sql+'SELECT COUNT(*) AS total,COALESCE(SUM(attention),0) AS attention,COALESCE(SUM(expiring),0) AS expiring,COALESCE(SUM(CASE WHEN pendingDevices>0 OR openIncidents>0 THEN 1 ELSE 0 END),0) AS devices,COALESCE(SUM(backupFailure),0) AS backups FROM flagged',...base.args);
    return {customers,total,nextCursor:cursor+customers.length<total?cursor+customers.length:null,summary,serverTime:now};
  }
  catalog(){return {plans:this.store.all('SELECT * FROM plans ORDER BY enabled DESC,name,id'),settings:JSON.parse(this.store.get('SELECT value FROM settings WHERE id=?','public')?.value||'{}')};}
  /** @param {string} accountId @param {boolean} owner @param {number} now */
  customer(accountId,owner,now){
    const base=this.directorySql(now),account=this.store.get(base.sql+'SELECT * FROM flagged WHERE id=?',...base.args,accountId);requireValue(account,'Customer account not found',404);
    const shops=this.store.all('SELECT id,name,customer_name FROM shops WHERE account_id=? ORDER BY name,id',accountId);
    const licenses=this.store.all('SELECT l.*,p.name AS planName FROM licenses l JOIN shops s ON s.id=l.shop_id JOIN plans p ON p.id=l.plan_id WHERE s.account_id=? ORDER BY s.id,l.kind,l.ends_at DESC,l.id',accountId);
    const installations=this.store.all('SELECT i.id,i.license_id,i.status,i.first_at,i.last_seen_at,i.last_activation_at,CASE WHEN l.writer_id=i.id THEN 1 ELSE 0 END AS writer,p.lease_until FROM installations i JOIN licenses l ON l.id=i.license_id LEFT JOIN presence p ON p.installation_id=i.id WHERE i.account_id=? ORDER BY i.first_at DESC,i.id',accountId);
    const incidents=this.store.all('SELECT i.id,i.license_id,i.kind,i.opened_at,i.resolved_at FROM incidents i JOIN licenses l ON l.id=i.license_id JOIN shops s ON s.id=l.shop_id WHERE s.account_id=? ORDER BY (i.resolved_at IS NOT NULL),i.opened_at DESC LIMIT 100',accountId);
    const backups=this.backups?this.store.all("SELECT s.id AS shopId,s.name,c.enabled,c.policy_version,c.notice_at,l.status,l.starts_at,l.ends_at,(SELECT COUNT(*) FROM backup_versions v WHERE v.shop_id=s.id AND v.status='ready') AS versionCount,(SELECT COALESCE(SUM(bytes),0) FROM backup_versions v WHERE v.shop_id=s.id AND v.status<>'deleted') AS bytes,(SELECT MAX(created_at) FROM backup_versions v WHERE v.shop_id=s.id AND v.status='ready') AS lastSuccessAt FROM shops s LEFT JOIN backup_consents c ON c.shop_id=s.id LEFT JOIN licenses l ON l.id=c.backup_license_id WHERE s.account_id=? ORDER BY s.name,s.id",accountId):[];
    const payments=owner?this.store.all('SELECT p.id,p.license_id,p.amount_minor,p.currency,p.paid_at,p.reference,p.note FROM payments p JOIN licenses l ON l.id=p.license_id JOIN shops s ON s.id=l.shop_id WHERE s.account_id=? ORDER BY p.created_at DESC,p.id LIMIT 100',accountId):[];
    const privacy=owner?this.store.get('SELECT id,status,created_at,updated_at,response_due_at,message_ar,message_fr FROM privacy_deletion_requests WHERE account_id=? ORDER BY created_at DESC LIMIT 1',accountId)||null:null;
    const ownerCode=owner?!!this.store.get('SELECT account_id FROM privacy_owner_credentials WHERE account_id=?',accountId):null;
    const audit=this.store.all("SELECT id,action,reason,at FROM audit WHERE (actor_id=? OR target_id IN (SELECT id FROM accounts WHERE id=? UNION SELECT id FROM shops WHERE account_id=? UNION SELECT l.id FROM licenses l JOIN shops s ON s.id=l.shop_id WHERE s.account_id=? UNION SELECT id FROM installations WHERE account_id=? UNION SELECT p.id FROM payments p JOIN licenses l ON l.id=p.license_id JOIN shops s ON s.id=l.shop_id WHERE s.account_id=?)) AND (?=1 OR action NOT LIKE 'payment.%') ORDER BY id DESC LIMIT 100",accountId,accountId,accountId,accountId,accountId,accountId,Number(owner));
    return {account,shops,licenses,installations,incidents,backups,payments,privacy,ownerCode,audit,serverTime:now};
  }
}
