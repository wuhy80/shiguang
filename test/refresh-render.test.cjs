const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('dist/app.js','utf8');
const refresh=source.slice(source.indexOf('function refreshCaptured()'),source.indexOf("window.addEventListener('storage'"));
test('focus and sync refresh only redraw when library content changes',()=>{
 let raw=JSON.stringify([{id:'a',title:'old'}]),renders=0;
 const ctx={$:()=>({open:false}),localStorage:{getItem:()=>raw},KEY:'key',items:[{id:'a',title:'old'}],persistedIds:new Set(['a']),demo:false,SG:{normalize:x=>x},render:()=>renders++,toast:()=>{throw Error('unexpected error')}};
 vm.runInNewContext(refresh+';globalThis.refresh=refreshCaptured;',ctx);ctx.refresh();assert.equal(renders,0);
 raw=JSON.stringify([{id:'a',title:'new'}]);ctx.refresh();assert.equal(renders,1);assert.equal(ctx.items[0].title,'new');ctx.refresh();assert.equal(renders,1);
});
