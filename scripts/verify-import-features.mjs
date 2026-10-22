import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mergeImport,sqliteBackup} from '../approved-runtime/import-domain.js';
import {upgradeState} from '../approved-runtime/upgrade-state.js';
import {reportDataset} from '../approved-runtime/report-data.js';
import {validateState} from '../approved-runtime/database.js';
globalThis.localStorage={getItem:()=>null};
globalThis.initSqlJs=createRequire(import.meta.url)('../approved-runtime/assets/sql-asm.js');
const fixture=()=>({originId:'origin-A',branding:'Shop',products:[{id:1,name:'Rice',sku:'1',price:20,cost:10,stocks:{A:30},qty:30}],parties:[{id:1,type:'customer',name:'Client',balance:10}],accounts:[{id:1,name:'Cash',balance:100}],warehouses:['A'],warehouse:'A',records:[],opening:{stocks:{1:{A:30}},parties:{1:10},accounts:{1:100}}});
const current=fixture();upgradeState(current);const incoming=fixture();incoming.originId='origin-B';incoming.accounts[0].balance=200;incoming.products[0].stocks.A=50;incoming.parties[0].balance=60;incoming.records=[{id:101,kind:'sale',date:'2026-10-01',total:100,paid:100,due:0,party:1,account:1,warehouse:'A',lines:[{product:1,name:'Rice',qty:5,price:20,costAtSale:10}],profit:50}];upgradeState(incoming);
const original=JSON.stringify(current),merged=mergeImport(current,incoming);validateState(merged.state);assert.equal(JSON.stringify(current),original);assert.equal(merged.state.accounts[0].balance,100);assert.equal(merged.state.products[0].stocks.A,30);assert.equal(merged.state.records.length,1);assert.equal(mergeImport(merged.state,incoming).state.records.length,1);assert.equal(reportDataset(merged.state,{type:'party-ledger',partyId:1}).closing,10);
const imported=mergeImport(current,incoming,{accounts:'imported',parties:'imported',stocks:'imported'});assert.equal(imported.state.accounts[0].balance,200);assert.equal(imported.state.parties[0].balance,60);assert.equal(imported.state.products[0].stocks.A,50);validateState(imported.state);
const ambiguous=fixture();ambiguous.products.push({...ambiguous.products[0],id:2});ambiguous.products[0].sku='';ambiguous.products[1].sku='';incoming.products[0].sku='';const conflict=mergeImport(ambiguous,incoming);assert.equal(conflict.conflicts.length,1);const chosen=mergeImport(ambiguous,incoming,{matches:{[conflict.conflicts[0].key]:'2'}});assert.equal(chosen.conflicts.length,0);assert.equal(chosen.state.records[0].lines[0].product,2);
const SQL=await initSqlJs(),db=new SQL.Database();for(const [table,rows]of Object.entries({products:[{id:'p',name:'SQL product'}],documents:[],warehouses:[{id:'w',name:'Depot'}],parties:[],payment_accounts:[{id:'cash',balance:100}],financial_movements:[]})){db.run('CREATE TABLE '+table+'(record_key TEXT PRIMARY KEY,data_json TEXT NOT NULL)');for(const r of rows)db.run('INSERT INTO '+table+' VALUES (?,?)',[r.id,JSON.stringify(r)])}
const official=await sqliteBackup(db.export());db.close();assert.equal(official.collections.products[0].name,'SQL product');assert.equal(official.collections.paymentAccounts[0].balance,100);
const legacy=new SQL.Database();for(const sql of [
 'CREATE TABLE itemsTB(id INTEGER,title TEXT,barcode TEXT,priceUnit REAL,start_Cost REAL)',
 "INSERT INTO itemsTB VALUES(1,'Legacy rice','9001',20,10)",
 'CREATE TABLE storesTB(id INTEGER,title TEXT)',"INSERT INTO storesTB VALUES(1,'Legacy depot')",
 'CREATE TABLE stores_itemsTB(id INTEGER,item_idFK INTEGER,store_idFK INTEGER,qty REAL)', 'INSERT INTO stores_itemsTB VALUES(1,1,1,25)',
 'CREATE TABLE customerTB(id INTEGER,title TEXT,Debitor REAL,Creditor REAL)',"INSERT INTO customerTB VALUES(1,'Legacy client',50,0)",
 'CREATE TABLE buyBillTB(id INTEGER,Date TEXT)', 'CREATE TABLE items_BuyTB(id INTEGER,BuyFK INTEGER,item_idFK INTEGER,qty REAL)',
 'CREATE TABLE purchBillTB(id INTEGER,Date TEXT)', 'CREATE TABLE items_purchTB(id INTEGER,purchFK INTEGER,item_idFK INTEGER,qty REAL)'
])legacy.run(sql);
const legacyResult=await sqliteBackup(legacy.export());legacy.close();assert.equal(legacyResult.collections.products[0].name,'Legacy rice');assert.equal(Object.values(legacyResult.collections.products[0].stocks)[0],25);assert.equal(legacyResult.collections.parties[0].receivable,50);assert.equal(legacyResult.collections.warehouses[0].name,'Legacy depot');
const withProvenance=fixture();upgradeState(withProvenance);withProvenance.stockEvents=[{productId:'1',documentId:'old-opening',documentRevision:7,warehouseId:'A',quantityDelta:30,type:'opening'}];withProvenance.stockEventSequence=7;const unchanged=mergeImport(withProvenance,structuredClone(withProvenance)).state;assert.deepEqual(unchanged.stockEvents,withProvenance.stockEvents);assert.equal(unchanged.products[0].openingHistoryLocked,undefined);
await assert.rejects(()=>sqliteBackup(new Uint8Array([1,2,3])));console.log(JSON.stringify({checks:20,status:'passed',formats:['mobile-json','desktop-sqlite','dataacc-db']}));
