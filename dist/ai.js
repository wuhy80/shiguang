(function(root){
 'use strict';
 // 客户端 AI 模块：纯逻辑（向量编解码、余弦、缓存）+ 边缘函数调用。
 // 语义向量只存本机 localStorage；摘要与标签随 payload 正常云同步。
 const STORE_KEY='shiguang.ai.embed.v1',DIMS=256,MAX_STORE=4000,BATCH=16;
 function fnv1a(str){let h=0x811c9dc5;str=String(str);for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return ('0000000'+h.toString(16)).slice(-8);}
 function digest(item){return [item&&item.title||'',item&&item.platform||'',...(Array.isArray(item&&item.tags)?item.tags:[]),...(Array.isArray(item&&item.aiTags)?item.aiTags:[]),item&&item.author||'',String(item&&item.notes||'').slice(0,300)].join('\n').slice(0,1000);}
 function b64encode(bytes){if(root.btoa){let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return root.btoa(bin);}if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');throw Error('no base64 encoder');}
 function b64decode(text){if(root.atob){const bin=root.atob(text);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}if(typeof Buffer!=='undefined')return new Uint8Array(Buffer.from(text,'base64'));throw Error('no base64 decoder');}
 function encodeVec(vec){return b64encode(new Uint8Array(vec.buffer,vec.byteOffset,vec.byteLength));}
 function decodeVec(text,dims){try{const bytes=b64decode(text);if(!bytes.length||bytes.length%4)return null;const vec=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);if(dims&&vec.length!==dims)return null;return vec;}catch{return null;}}
 function cosine(a,b){if(!a||!b||!a.length||a.length!==b.length)return 0;let dot=0,na=0,nb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return na&&nb?dot/Math.sqrt(na*nb):0;}
 // --- 本机向量缓存：url -> {h:内容指纹,v:base64向量,at:时间}，超限按最旧淘汰，写入失败丢一半重试 ---
 let store=null;
 function loadStore(){if(store)return store;try{const raw=JSON.parse(root.localStorage.getItem(STORE_KEY)||'null');store=raw&&typeof raw==='object'&&raw.dims===DIMS&&raw.entries&&typeof raw.entries==='object'?raw:{dims:DIMS,entries:{}};}catch{store={dims:DIMS,entries:{}};}return store;}
 function persistStore(){if(!store)return;try{root.localStorage.setItem(STORE_KEY,JSON.stringify(store));}catch{const entries=Object.entries(store.entries).sort((a,b)=>(a[1].at||0)-(b[1].at||0));store.entries=Object.fromEntries(entries.slice(Math.floor(entries.length/2)));try{root.localStorage.setItem(STORE_KEY,JSON.stringify(store));}catch{}}}
 function entryHash(item){return fnv1a(digest(item));}
 function get(item){const entry=loadStore().entries[item.url];if(!entry||entry.h!==entryHash(item))return null;return decodeVec(entry.v,DIMS);}
 function put(item,vec){if(!vec||vec.length!==DIMS)return;const s=loadStore();s.entries[item.url]={h:entryHash(item),v:encodeVec(vec),at:Date.now()};const urls=Object.keys(s.entries);if(urls.length>MAX_STORE){urls.sort((a,b)=>(s.entries[a].at||0)-(s.entries[b].at||0));for(const url of urls.slice(0,urls.length-MAX_STORE))delete s.entries[url];}persistStore();}
 function clear(){store={dims:DIMS,entries:{}};try{root.localStorage.removeItem(STORE_KEY);}catch{}}
 function stats(items){const s=loadStore();let indexed=0;for(const item of items){const entry=s.entries[item.url];if(entry&&entry.h===entryHash(item)&&decodeVec(entry.v,DIMS))indexed++;}return {indexed,total:items.length};}
 function semanticRank(items,queryVec,{min=0.3}={}){if(!queryVec||!queryVec.length)return [];const out=[];for(const item of items){const vec=get(item);if(!vec)continue;const score=cosine(vec,queryVec);if(score>=min)out.push({item,score});}return out.sort((a,b)=>b.score-a.score);}
 function normalizeAiTags(value){if(!Array.isArray(value))return [];const out=[];for(const raw of value){if(typeof raw!=='string')continue;const tag=raw.replace(/^#/,'').replace(/\s+/g,' ').trim().slice(0,20);if(tag&&!out.some(t=>t===tag||t.includes(tag)||tag.includes(t)))out.push(tag);if(out.length>=5)break;}return out;}
 function extractJson(text){const clean=String(text).replace(/```(?:json)?/gi,'');const start=clean.indexOf('{');if(start<0)return null;let depth=0,inString=false,escape=false;for(let i=start;i<clean.length;i++){const c=clean[i];if(escape){escape=false;continue;}if(c==='\\'){escape=true;continue;}if(c==='"'){inString=!inString;continue;}if(inString)continue;if(c==='{')depth++;else if(c==='}'){depth--;if(!depth){try{return JSON.parse(clean.slice(start,i+1));}catch{return null;}}}}return null;}
 // --- 网络调用：鉴权与 preview-client 相同；501 视为未配置，会话内不再重试 ---
 let unavailable=false,probed=false;
 const fail=(code)=>Object.assign(Error(code),{code});
 function markUnavailable(){if(unavailable)return;unavailable=true;try{root.dispatchEvent(new Event('shiguang-ai-status'));}catch{}}
 async function call(name,payload,timeout=20000){
  if(unavailable)throw fail('ai_not_configured');
  const cloud=root.ShiguangCloud;if(!cloud)throw fail('sign_in_required');
  await cloud.ready;const {data}=await cloud.client.auth.getSession();
  if(!data.session)throw fail('sign_in_required');
  let response;
  try{response=await fetch(root.ShiguangCloudConfig.url+'/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json',apikey:root.ShiguangCloudConfig.key,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)});}
  catch{throw fail('ai_unavailable');}
  if(response.status===501){markUnavailable();throw fail('ai_not_configured');}
  if(!response.ok){let code='ai_unavailable';try{const body=await response.json();if(body&&body.error)code=body.error;}catch{}throw fail(code);}
  return response.json();
 }
 function probe(){unavailable=false;return call('ai-embed',{texts:['拾光语义搜索可用性检测']}).then(result=>{probed=true;return true;}).catch(error=>{if(error.code==='ai_not_configured'){probed=true;return false;}throw error;});}
 async function embed(texts){if(!Array.isArray(texts)||!texts.length)throw fail('ai_unavailable');const out=[];for(let i=0;i<texts.length;i+=BATCH){const slice=texts.slice(i,i+BATCH).map(t=>String(t).slice(0,1000));const result=await call('ai-embed',{texts:slice},30000);const vectors=Array.isArray(result?.embeddings)?result.embeddings:[];if(vectors.length!==slice.length)throw fail('ai_unavailable');out.push(...vectors);}return out;}
 async function ensureEmbedding(item){const cached=get(item);if(cached)return cached;const [vector]=await embed([digest(item)]);if(!Array.isArray(vector)||!vector.length)throw fail('ai_unavailable');const vec=Float32Array.from(vector);put(item,vec);return vec;}
 const queryCache=new Map();
 async function queryVector(q){const text=String(q).slice(0,1000),key=fnv1a(text);if(queryCache.has(key))return queryCache.get(key);const [vector]=await embed([text]);if(!Array.isArray(vector)||!vector.length)throw fail('ai_unavailable');const vec=Float32Array.from(vector);queryCache.set(key,vec);return vec;}
 const backoff=new Map();
 function onBackoff(item){return Date.now()<(backoff.get(item.url)||0);}
 function markBackoff(item,ms=1800000){backoff.set(item.url,Date.now()+ms);}
 async function enrich(item){
  const result=await call('ai-enrich',{mode:'enrich',url:item.url,title:String(item.title||'').slice(0,500),platform:item.platform||'other',tags:(item.tags||[]).slice(0,20),notes:String(item.notes||'').slice(0,500),author:String(item.author||'').slice(0,150)},60000);
  const summary=String(result?.summary||'').replace(/\s+/g,' ').trim().slice(0,120),tags=normalizeAiTags(result?.tags);
  if(!summary)throw fail('ai_unavailable');
  return {summary,tags};
 }
 async function digestReview({recent,unreadCount}){
  const list=(Array.isArray(recent)?recent:[]).slice(0,100).map(x=>({title:String(x.title||'').slice(0,120),platform:x.platform||'',tags:(x.tags||[]).slice(0,8),notes:String(x.notes||'').slice(0,80),read:x.read===true}));
  if(!list.length)throw fail('bad_request');
  const result=await call('ai-enrich',{mode:'digest',items:list,unreadCount:Number(unreadCount)||0},90000);
  const text=String(result?.digest||'').trim().slice(0,4000);
  if(!text)throw fail('ai_unavailable');
  return text;
 }
 const api={fnv1a,digest,encodeVec,decodeVec,cosine,semanticRank,normalizeAiTags,extractJson,get,put,clear,stats,probe,embed,ensureEmbedding,queryVector,enrich,digestReview,onBackoff,markBackoff,STORE_KEY,DIMS};
 Object.defineProperty(api,'unavailable',{get:()=>unavailable});
 Object.defineProperty(api,'probed',{get:()=>probed});
 root.SGAi=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
