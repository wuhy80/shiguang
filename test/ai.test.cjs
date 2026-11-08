const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const SG=require('../dist/core.js'),AI=require('../dist/ai.js');

function bootAi(extra={}){
 const storage={map:new Map(),getItem(k){return this.map.has(k)?this.map.get(k):null},setItem(k,v){this.map.set(k,String(v))},removeItem(k){this.map.delete(k)}};
 const page={window:null,localStorage:storage,btoa:globalThis.btoa,atob:globalThis.atob,dispatchEvent:()=>{},...extra};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/ai.js','utf8'),page);
 return {page,SGAi:page.SGAi,storage};
}
function okResponse(body,status=200){return {ok:status>=200&&status<300,status,json:async()=>body,text:async()=>JSON.stringify(body)};}
function bootCloud(fetchImpl,session={access_token:'token-123'}){
 return bootAi({fetch:fetchImpl,AbortSignal,ShiguangCloudConfig:{url:'https://example.supabase.co',key:'publishable-key'},ShiguangCloud:{ready:Promise.resolve(),client:{auth:{getSession:async()=>({data:{session}})}}}});
}

test('fnv1a is deterministic and order sensitive',()=>{
 const A=AI.fnv1a('拾光');
 assert.equal(A,AI.fnv1a('拾光'));assert.notEqual(A,AI.fnv1a('光拾'));assert.match(A,/^[0-9a-f]{8}$/);
});

test('digest packs title platform tags notes deterministically and caps length',()=>{
 const item=SG.normalize({url:'https://www.bilibili.com/video/BV1',title:'线性代数的本质',tags:['数学'],notes:'用图形直觉理解线性代数。'});
 const first=AI.digest(item),again=AI.digest(item);
 assert.equal(first,again);assert.ok(first.includes('线性代数的本质'));assert.ok(first.includes('数学'));assert.ok(first.includes('bilibili'));
 assert.ok(AI.digest({...item,notes:'长'.repeat(2000)}).length<=1000);
});

test('vectors survive base64 roundtrip and reject mismatched dims or garbage',()=>{
 const A=require('../dist/ai.js');
 const vec=Float32Array.from({length:256},(_,i)=>(i-128)/128);
 assert.deepEqual([...A.decodeVec(A.encodeVec(vec),256)],[...vec]);
 assert.equal(A.decodeVec(A.encodeVec(vec),128),null);
 assert.equal(A.decodeVec('not-base64!!',256),null);
 assert.equal(A.decodeVec(btoa('12345'),256),null);
});

test('cosine handles identical orthogonal opposite and degenerate vectors',()=>{
 const A=require('../dist/ai.js');
 const a=Float32Array.from([1,0]),b=Float32Array.from([0,1]),c=Float32Array.from([-1,0]),zero=Float32Array.from([0,0]);
 assert.ok(Math.abs(A.cosine(a,a)-1)<1e-9);assert.equal(A.cosine(a,b),0);assert.ok(Math.abs(A.cosine(a,c)+1)<1e-9);
 assert.equal(A.cosine(a,zero),0);assert.equal(A.cosine(a,Float32Array.from([1,2,3])),0);
});

test('semanticRank sorts by similarity, cuts below threshold and skips unindexed items',()=>{
 const {SGAi:A}=bootAi();
 const make=title=>SG.normalize({url:'https://example.com/'+encodeURIComponent(title),title});
 const target=make('精力管理方法'),other=make('Python 教程'),noVector=make('未索引条目');
 A.put(target,Float32Array.from({length:256},(_,i)=>i===0?1:0));A.put(other,Float32Array.from({length:256},(_,i)=>i===1?1:0));
 const query=Float32Array.from({length:256},(_,i)=>i===0?1:(i===1?0.1:0));
 const ranked=A.semanticRank([noVector,other,target],query,{min:0.3});
 assert.deepEqual([...ranked].map(r=>r.item.title),['精力管理方法']);assert.ok(ranked[0].score>0.9);
 assert.equal(A.semanticRank([target],null).length,0);
});

test('embedding cache invalidates when entry content changes and reports stats',()=>{
 const {SGAi}=bootAi();
 const item=SG.normalize({url:'https://example.com/a',title:'原标题'});
 SGAi.put(item,Float32Array.from({length:256},(_,i)=>i/256));
 assert.ok(SGAi.get(item));assert.equal(SGAi.stats([item]).indexed,1);
 item.notes='补充了笔记';assert.equal(SGAi.get(item),null);assert.equal(SGAi.stats([item]).indexed,0);
});

test('cache survives storage quota errors by keeping the in-memory index',()=>{
 const page={window:null,localStorage:{getItem:()=>null,setItem:()=>{throw Error('quota')},removeItem:()=>{}},btoa:globalThis.btoa,atob:globalThis.atob,dispatchEvent:()=>{}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/ai.js','utf8'),page);
 const item=SG.normalize({url:'https://example.com/q',title:'配额测试'});
 assert.doesNotThrow(()=>page.SGAi.put(item,Float32Array.from([1,2,3,4].concat(Array(252).fill(0)))));
 assert.ok(page.SGAi.get(item));
});

test('normalizeAiTags cleans, dedupes, caps count and length',()=>{
 const A=require('../dist/ai.js');
 assert.deepEqual(A.normalizeAiTags(['#AI','AI','机器 学习','深度学习','强化学习','模仿学习','#超出二十个字的标签会被截断'.padEnd(25,'字')]),['AI','机器 学习','深度学习','强化学习','模仿学习']);
 assert.deepEqual(A.normalizeAiTags('nope'),[]);assert.deepEqual(A.normalizeAiTags([42,null,'']),[]);
});

test('extractJson recovers model output from fences and prose, rejects malformed text',()=>{
 const A=require('../dist/ai.js');
 assert.deepEqual(A.extractJson('{"summary":"好文","tags":["a"]}'),{summary:'好文',tags:['a']});
 assert.deepEqual(A.extractJson('好的，结果如下：\n```json\n{"summary":"好文","tags":[]}\n```\n希望有帮助'),{summary:'好文',tags:[]});
 assert.deepEqual(A.extractJson('前缀 {"summary":"含}花括号","tags":[]} 后缀'),{summary:'含}花括号','tags':[]});
 assert.equal(A.extractJson('完全没有结构化内容'),null);assert.equal(A.extractJson('{"summary":'),null);
});

test('core normalize preserves AI fields and keyword search covers AI tags',()=>{
 const item=SG.normalize({url:'https://example.com/ai',title:'一篇讲精力管理的文章',aiSummary:'  从精力而非时间出发的时间管理。 ',aiTags:['#精力管理','时间管理','精力管理','无效',42]});
 assert.equal(item.aiSummary,'从精力而非时间出发的时间管理。');assert.deepEqual(item.aiTags,['精力管理','时间管理','无效']);
 assert.equal(SG.normalize({url:'https://example.com/x',title:'无 AI 字段'}).aiSummary,undefined);
 const hits=SG.filter([item,{...item,url:'https://example.com/y',id:'b'}],{q:'精力管理'});
 assert.equal(hits.length,2);
});

test('edge call marks AI unavailable after 501 and stops retrying for the session',async()=>{
 let calls=0;const {SGAi}=bootCloud(async()=>{calls++;return okResponse({error:'ai_not_configured'},501);});
 await assert.rejects(SGAi.enrich(SG.normalize({url:'https://example.com/a',title:'t'})),/ai_not_configured/);
 assert.equal(calls,1);assert.equal(SGAi.unavailable,true);
 await assert.rejects(SGAi.embed(['x']),/ai_not_configured/);assert.equal(calls,1);
});

test('probe reports false when unconfigured and true when available',async()=>{
 const down=bootCloud(async()=>okResponse({error:'ai_not_configured'},501));
 assert.equal(await down.SGAi.probe(),false);assert.equal(down.SGAi.probed,true);assert.equal(down.SGAi.unavailable,true);
 const vectors=[Array(256).fill(0.1)];
 const up=bootCloud(async(url,init)=>{assert.equal(url,'https://example.supabase.co/functions/v1/ai-embed');return okResponse({embeddings:vectors,dims:256});});
 assert.equal(await up.SGAi.probe(),true);
});

test('enrich sends auth headers and entry context, normalizes returned tags',async()=>{
 let captured=null;const {SGAi}=bootCloud(async(url,init)=>{
  captured={url,headers:init.headers,body:JSON.parse(init.body)};
  return okResponse({summary:' 一篇讲精力管理的文章 。',tags:['#精力管理','精力管理','时间管理']});
 });
 const result=await SGAi.enrich(SG.normalize({url:'https://example.com/e',title:'精力管理',tags:['时间'],notes:'我的原因'}));
 assert.equal(captured.url,'https://example.supabase.co/functions/v1/ai-enrich');
 assert.equal(captured.headers.apikey,'publishable-key');assert.equal(captured.headers.Authorization,'Bearer token-123');
 assert.equal(captured.body.mode,'enrich');assert.equal(captured.body.title,'精力管理');assert.equal(captured.body.notes,'我的原因');
 assert.equal(result.summary,'一篇讲精力管理的文章 。');assert.deepEqual([...result.tags],['精力管理','时间管理']);
});

test('embed batches texts sixteen at a time',async()=>{
 const calls=[];const {SGAi}=bootCloud(async(url,init)=>{const body=JSON.parse(init.body);calls.push(body.texts.length);return okResponse({embeddings:body.texts.map(()=>Array(256).fill(0)),dims:256});});
 const vectors=await SGAi.embed(Array.from({length:20},(_,i)=>'文本'+i));
 assert.equal(vectors.length,20);assert.deepEqual(calls,[16,4]);
});

test('digestReview maps items and returns markdown text, refuses empty lists',async()=>{
 let body=null;const {SGAi}=bootCloud(async(url,init)=>{body=JSON.parse(init.body);return okResponse({digest:'## 收藏亮点\n- 精力管理一文值得先读'});});
 const text=await SGAi.digestReview({recent:[{title:'精力管理',platform:'zhihu',tags:['管理'],notes:'理由',read:false}],unreadCount:7});
 assert.equal(body.mode,'digest');assert.equal(body.unreadCount,7);assert.equal(body.items[0].title,'精力管理');
 assert.match(text,/收藏亮点/);
 await assert.rejects(SGAi.digestReview({recent:[],unreadCount:0}),/bad_request/);
});

test('call requires a signed-in session before touching the network',async()=>{
 let calls=0;const {SGAi}=bootCloud(async()=>{calls++;return okResponse({embeddings:[[]]});},null);
 await assert.rejects(SGAi.embed(['x']),/sign_in_required/);assert.equal(calls,0);
});

test('network failures surface as retryable ai_unavailable, not session loss',async()=>{
 const {SGAi}=bootCloud(async()=>{throw new Error('boom');});
 await assert.rejects(SGAi.embed(['x']),/ai_unavailable/);assert.equal(SGAi.unavailable,false);
});
