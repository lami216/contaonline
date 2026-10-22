import assert from 'node:assert/strict';
import {upgradeState,validateFeatureState,setCategory,deleteCategory,archiveParty,archiveWarehouse,moneyAccountDelta,nextDocumentNumber} from '../approved-runtime/upgrade-state.js';
import {reportDataset,reportWorkbookData} from '../approved-runtime/report-data.js';
import {openingState,recordStockEvents,planOpeningRecord,stockOperationRecord} from '../approved-runtime/stock-domain.js';
import {setPermission} from '../approved-runtime/permission-catalog.js';
globalThis.localStorage={getItem:()=>null};
const state=()=>({branding:'Shop',warehouse:'A',warehouses:['A','B'],products:[{id:1,name:'Rice',price:10,cost:4,qty:20,stocks:{A:20,B:0}},{id:2,name:'Oil',price:20,cost:8,qty:10,stocks:{A:10,B:0}}],parties:[{id:1,type:'customer',name:'Client',phone:'123',balance:140},{id:2,type:'supplier',name:'Supplier',balance:80}],accounts:[{id:1,name:'Cash',balance:1120},{id:2,name:'Bank',balance:80}],records:[
 {id:101,kind:'sale',date:'2026-10-01',total:100,paid:0,due:100,party:1,warehouse:'A',profit:60,lines:[{product:1,name:'Rice',qty:10,price:10,costAtSale:4}]},
 {id:102,kind:'receive',date:'2026-10-02',total:30,paid:30,due:0,party:1,account:1,lines:[]},
 {id:103,kind:'pay',date:'2026-10-03',total:20,paid:20,due:0,party:1,account:1,lines:[]},
 {id:104,kind:'purchase',date:'2026-10-02',total:80,paid:0,due:80,party:2,warehouse:'A',lines:[{product:2,name:'Oil',qty:10,price:8}]},
 {id:105,kind:'expense',date:'2026-10-04',total:10,paid:10,due:0,account:1,lines:[]},
 {id:106,kind:'transfer',date:'2026-10-04',total:80,paid:80,due:0,account:1,to:2,lines:[]},
 {id:107,kind:'sale',date:'2026-10-05',voided:true,total:999,paid:999,due:0,account:1,lines:[]}
 ],opening:{accounts:{1:1200,2:0},parties:{1:50,2:0},stocks:{1:{A:30,B:0},2:{A:0,B:0}}}});
let checks=0;const check=(label,fn)=>{fn();checks++;};
const s=state(),original=structuredClone(s);upgradeState(s);
check('additive migration preserves every balance and historical ID',()=>{assert.deepEqual(s.accounts.map(a=>a.balance),original.accounts.map(a=>a.balance));assert.deepEqual(s.parties,original.parties);assert.deepEqual(s.products,original.products);assert.deepEqual(s.records.map(r=>[r.id,r.total,r.paid,r.due]),original.records.map(r=>[r.id,r.total,r.paid,r.due]));assert.equal(upgradeState(s),false)});
check('display currency never converts money',()=>{s.currency={code:'EUR',availableCodes:['MRU','EUR']};validateFeatureState(s);assert.equal(s.accounts[0].balance,1120);assert.equal(reportDataset(s,{type:'sales'}).currency,'EUR')});
check('every report exports its own scope',()=>{for(const [type,kinds]of Object.entries({sales:['sale'],purchases:['purchase'],expenses:['expense'],profit:['sale','expense']}))assert.deepEqual([...new Set(reportDataset(s,{type}).records.map(r=>r.kind))].sort(),kinds.sort());assert.equal(reportDataset(s,{type:'sales'}).metrics[0].value,100);});
check('party ledger includes opening, signed receipt/payment, closing',()=>{const d=reportDataset(s,{type:'party-ledger',partyId:1});assert.equal(d.opening,50);assert.equal(d.closing,140);assert.equal(d.rows.length,4);const period=reportDataset(s,{type:'party-ledger',partyId:1,allTime:false,from:'2026-10-02',to:'2026-10-03'});assert.equal(period.opening,150);assert.equal(period.closing,140)});
check('supplier balances use inverse orientation and never mix clients',()=>{const d=reportDataset(s,{type:'party-ledger',partyId:2});assert.equal(d.closing,-80);assert.equal(d.rows.length,2)});
check('financial transfers debit and credit independently without double counting',()=>{const d=reportDataset(s,{type:'financial'});assert.equal(d.metrics[0].value,110);assert.equal(d.metrics[1].value,110);assert.equal(d.rows.filter(r=>r.id.startsWith('106-')).length,2);assert.equal(moneyAccountDelta(s.records[5],2),80)});
check('spreadsheet money remains numeric',()=>{const d=reportDataset(s,{type:'sales'}),w=reportWorkbookData(s,d);assert.equal(typeof w[1].rows[1][3],'number');assert.match(w[1].rows[0][3],/EUR/)});
check('category lifecycle and report filter',()=>{setCategory(s,0,'Food');s.products[0].categoryId=1;assert.equal(reportDataset(s,{type:'product-sales',categoryId:1}).rows.length,1);assert.throws(()=>setCategory(s,0,'Food'));deleteCategory(s,1);assert.equal(s.products[0].categoryId,null)});
check('archive guards preserve outstanding accounts and stocked warehouses',()=>{assert.throws(()=>archiveParty(s,1));assert.throws(()=>archiveWarehouse(s,'A'));s.parties.push({id:3,name:'Closed',balance:0,type:'customer'});archiveParty(s,3);assert.equal(s.parties[2].archived,true)});
check('document sequence is independent per kind and includes voided numbers',()=>{assert.equal(nextDocumentNumber(s,'sale'),3);assert.equal(nextDocumentNumber(s,'purchase'),2);assert.equal(nextDocumentNumber(s,'expense'),2)});
check('multi-line stock operation validates every line before posting',()=>{const d={from:'A',to:'B',note:'transfer',lines:[{product:1,quantity:2},{product:2,quantity:3}]};const r=stockOperationRecord(s,'transfer',d,null,110,'2026-10-19','10:00');assert.equal(r.lines.length,2);d.lines[1].quantity=100;assert.throws(()=>stockOperationRecord(s,'transfer',d,null,111,'2026-10-19','10:00'));assert.equal(s.products[0].stocks.A,20)});
check('permission dependencies remove dependents with their required view',()=>{const caps=setPermission([], 'pos.edit',true);assert.ok(caps.includes('pos.view'));assert.ok(!setPermission(caps,'pos.view',false).includes('pos.edit'))});
const historical=state();upgradeState(historical);historical.products[0].cost=99;delete historical.records[0].lines[0].costAtSale;check('legacy single-line margin uses saved invoice profit, never today’s cost',()=>{assert.equal(reportDataset(historical,{type:'product-sales'}).rows[0].profit,60);assert.equal(reportDataset(historical,{type:'sales',productId:1}).rows[0].cost,40)});
const opening=state();opening.records=[];opening.opening.stocks={1:{A:0,B:0},2:{A:0,B:0}};upgradeState(opening);opening.stockEvents=[];const p=opening.products[0];
const originalOpening={id:201,kind:'adjustment',openingStock:true,warehouse:'A',date:'2026-10-01',total:0,lines:[{product:1,name:p.name,qty:20,delta:20,price:4}]};opening.records.push(originalOpening);recordStockEvents(opening,originalOpening);
const sale={id:202,kind:'sale',warehouse:'A',date:'2026-10-02',lines:[{product:1,qty:5,price:10}]};opening.records.push(sale);recordStockEvents(opening,sale);p.stocks.A=15;
const provenance=await openingState(opening,p);
check('desktop opening provenance tracks consumed and remaining',()=>{assert.equal(provenance.total,20);assert.equal(provenance.consumed,5);assert.equal(provenance.remaining,15);assert.throws(()=>planOpeningRecord(opening,p,provenance,4,4,'A',false,203,'2026-10-19','10:00','correction'));const r=planOpeningRecord(opening,p,provenance,25,4,'B',true,203,'2026-10-19','10:00','correction');assert.equal(r.lines.reduce((n,l)=>n+l.delta,0),5)});
recordStockEvents(opening,sale,-1,'void');const restored=await openingState(opening,p);check('void restores the opening units',()=>{assert.equal(restored.remaining,20);assert.equal(restored.consumed,0)});
console.log(JSON.stringify({checks,status:'passed'}));
