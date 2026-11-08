const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('dist/app.js','utf8');
const bulk=app.slice(app.indexOf('function updateBatchUI('),app.indexOf('function openModal('));
function harness(){
 const nodes={};const $=key=>nodes[key]??={hidden:false,disabled:false,textContent:'',setAttribute(){},addEventListener(){}};
 const events=[],storage={owner:'account-a',getItem(){return this.owner}};
 const ctx={$,localStorage:storage,SG:{filter:(items,state)=>items.filter(x=>!state.only||x.id===state.only)},state:{},items:[{id:'a'},{id:'b'},{id:'c'}],demo:false,batchMode:false,batchOwner:null,batchSelected:new Set(),data(){return ctx.items},render(){events.push('render')},openModal(title,body){events.push({title,body})},closeModal(){events.push('close')},toast(t){events.push(t)},save(){events.push('save');return true}};
 vm.runInNewContext(bulk,ctx);return {ctx,nodes,events,storage};
}
test('batch selects current results only, retains other selections, and deletes after confirmation in one save',()=>{
 const {ctx,nodes,events}=harness();nodes['#batch-toggle'].onclick();ctx.state.only='a';nodes['#batch-select-visible'].onclick();ctx.state.only='b';nodes['#batch-select-visible'].onclick();
 assert.deepEqual([...ctx.batchSelected],['a','b']);nodes['#batch-delete'].onclick();assert.equal(ctx.items.length,3);assert.match(events.find(x=>x.title).body,/2 条/);
 nodes['#confirm-batch-delete'].onclick();assert.deepEqual(ctx.items.map(x=>x.id),['c']);assert.equal(events.filter(x=>x==='save').length,1);
});
test('failed storage and account changes do not delete selected entries',()=>{
 const {ctx,nodes,storage}=harness();nodes['#batch-toggle'].onclick();nodes['#batch-select-visible'].onclick();nodes['#batch-delete'].onclick();ctx.save=()=>false;nodes['#confirm-batch-delete'].onclick();assert.equal(ctx.items.length,3);assert.equal(ctx.batchSelected.size,3);
 storage.owner='account-b';nodes['#confirm-batch-delete'].onclick();assert.equal(ctx.items.length,3);assert.equal(ctx.batchSelected.size,0);
});
