import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {invoiceDocument} from '../approved-runtime/invoice-view.js';
let engine=fs.readFileSync('approved-runtime/engine.js','utf8').split("document.addEventListener('click'")[0];
engine=engine.replace(/const form=[^\r\n]*/,"const form=()=>inputForm,error=t=>{lastError=t},toast=()=>{};\n");
const c={inputForm:{},lastError:null,console,assert,structuredClone,crypto,document:{addEventListener(){},querySelector(){return null}},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};
vm.createContext(c);vm.runInContext(engine+'\nrender=()=>{};reset();',c);
vm.runInContext(`
const supplier=S.parties.find(p=>p.type==='supplier');
for(const kind of ['sale','purchase','pay','receive']){
 const r={...S.records[0],id:900,kind,party:supplier.id,voided:false};S.records.push(r);
 const before=JSON.stringify(S);editingId=null;modal=null;cart=[];act('source-location:900');
 assert.equal(view,kind==='sale'?'sale-source':kind==='purchase'?'purchase-source':'cash');assert.equal(selected,0);assert.equal(modal,null);assert.equal(editingId,null);assert.equal(cart.length,0);assert.equal(JSON.stringify(S),before);
 act('invoice:900');assert.equal(view,'invoice');assert.equal(modal,null);assert.equal(editingId,null);assert(invoiceIsAtSource(r));S.records.pop();
}
const many=Array.from({length:140},(_,i)=>({...S.records[0],id:1000+i,kind:'purchase',party:supplier.id,voided:false}));S.records=many;
act('source-location:1130');assert(rows(many).includes('invoice:1130'));assert.equal(listWindowPages.get(listWindowKey('سجل المستندات')),3);
let scrolled=0;const row={classList:{add(){}},setAttribute(){},scrollIntoView(){scrolled++}};focusLocatedRecord({querySelector(){return row}});focusLocatedRecord({querySelector(){return row}});assert.equal(scrolled,1);
S.records[130].voided=true;act('source-location:1130');assert(rows(liveRecords()).includes('invoice:1130'));view='cash';assert(!rows([]).includes('invoice:1130'));
for(const [kind,target] of [['sale','sale-source'],['expense','expenses'],['stocktransfer','transfer'],['adjustment','adjustment'],['deposit','accounts'],['withdraw','accounts'],['transfer','accounts']]){
 S.records.push({...S.records[0],id:900,kind,party:null,voided:false});cart=[];editingId=null;modal=null;const before=JSON.stringify(S);act('source-location:900');assert.equal(view,target);assert.equal(selected,0);if(['deposit','withdraw','transfer'].includes(kind))assert.equal(accountsTab,kind==='transfer'?'transfers':'adjustments');assert.equal(modal,null);assert.equal(editingId,null);assert.equal(cart.length,0);assert.equal(JSON.stringify(S),before);S.records.pop();
}
S.records[0].voided=false;cart=[];editingId=null;act('source-location:'+S.records[0].id);act('invoice:'+S.records[0].id);assert(invoiceIsAtSource(S.records[0]));act('source:'+S.records[0].id);assert.equal(view,'purchase');assert.equal(editingId,S.records[0].id);
reset();selected=5;view='account';assert(!accountDetail().includes('open:deposit'));assert(!accountDetail().includes('open:withdraw'));assert(!accountDetail().includes('open:cashtransfer'));
for(const action of ['open:deposit','open:withdraw','open:cashtransfer']){view='account';selected=5;act(action);assert.equal(view,'accounts');assert.equal(selected,0);assert.equal(accountsTab,action==='open:cashtransfer'?'transfers':'adjustments');assert(sheet().includes('اختر الحساب'));assert(!sheet().includes('value="5" selected'));assert(!sheet().includes('value="1" selected'))}
reset();view='accounts';accountsTab='adjustments';selected=777;assert(sourceDestinationMatches(documentSourceDestination({kind:'deposit'})));reset();act('open:pay');assert.equal(view,'cash');assert.equal(modal,'pay');assert.equal(editingId,null);assert(utility().includes('سجل الدفع والاستلام'));
const payment={...S.records[0],id:900,kind:'pay',party:supplier.id,account:5,total:100,paid:100,note:'old',lines:[]};S.records.push(payment);act('source-location:900');act('invoice:900');act('source:900');assert.equal(view,'cash');assert.equal(editingId,900);assert.equal(modal,'partyCash');assert.equal(cashDraft.account,5);assert.equal(cashDraft.party,supplier.id);
const deposit={...payment,id:901,kind:'deposit',party:null};S.records.push(deposit);act('source-location:901');assert.equal(accountsTab,'adjustments');accountsTab='transfers';let painted=0;focusLocatedRecord({querySelector(){painted++;return row}});assert.equal(painted,0);act('invoice:901');assert(!invoiceIsAtSource(deposit));act('source-location:901');act('invoice:901');act('source:901');assert.equal(view,'accounts');assert.equal(accountsTab,'adjustments');assert.equal(editingId,901);assert.equal(modal,'deposit');assert(sheet().includes('value="5" selected'));
reset();act('open:deposit');const cashBefore=JSON.stringify(S);inputForm={account:'',amount:'100'};act('post-cash');assert(lastError);assert.equal(JSON.stringify(S),cashBefore);
reset();act('new:sale');act('pos:add:1');const draft=JSON.stringify(cart);act('source-location:104');assert.equal(view,'sale-source');assert.equal(JSON.stringify(cart),draft);assert.equal(modal,null);
reset();cart=[];const focusId=S.records.find(r=>r.kind==='sale').id;
act('source-location:'+focusId);assert.equal(sourceRecordFocus,focusId);
act('invoice:'+focusId);assert.equal(sourceRecordFocus,null);assert(invoiceIsAtSource(S.records.find(r=>r.id===focusId)));act('back');assert.equal(sourceRecordFocus,null);
act('source-location:'+focusId);act('go:inventory');act('back');assert.equal(sourceRecordFocus,null);
act('source-location:'+focusId);view='home';focusLocatedRecord({querySelector(){throw Error('must not paint outside source')}});assert.equal(sourceRecordFocus,null);view='sale-source';assert.equal(sourceRecordFocus,null);
act('source-location:'+focusId);assert.equal(sourceRecordFocus,focusId);

`,c);
const state=vm.runInContext('S',c),record=state.records[0];
const render=atSource=>invoiceDocument(state,record,{esc:x=>String(x??''),money:x=>String(x),icon:()=>'',labels:{purchase:'فاتورة شراء'},atSource});
assert(render(false).includes(`source-location:${record.id}`));assert(!render(false).includes(`data-action="source:${record.id}"`));assert(!render(true).includes(`source-location:${record.id}`));assert(render(true).includes(`data-action="source:${record.id}"`));
console.log('PASS locate and highlight without opening/editing, distant/cancelled rows, workflow sources instead of owners/accounts, tab scoping, centralized cash/deposit, required account choice, preserved drafts, row opens detail and Edit alone opens editor');

