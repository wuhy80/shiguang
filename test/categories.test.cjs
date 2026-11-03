const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('dist/app.js','utf8');
test('category lists preserve device order, include synced labels, and isolate accounts',()=>{
 const values={'shiguang.cloud.owner':'alice','shiguang.categories.v1.alice':JSON.stringify(['学习','空分组'])};
 const ctx={localStorage:{getItem:k=>values[k]??null,setItem:(k,v)=>values[k]=v},items:[{tags:['学习','视频']}],toast(){}};
 const code=source.slice(source.indexOf('const categoryKey='),source.indexOf('function manageCategories()'));
 vm.runInNewContext(code+';globalThis.read=categories;globalThis.write=putCategories;',ctx);
 assert.deepEqual([...ctx.read()],['学习','空分组','视频']);ctx.write(['视频','学习','空分组']);assert.deepEqual([...ctx.read()],['视频','学习','空分组']);
 values['shiguang.cloud.owner']='bob';assert.deepEqual([...ctx.read()],['学习','视频']);
});
