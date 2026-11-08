// AI 摘要服务：enrich 模式生成一句话摘要与建议标签，digest 模式聚合近 7 天收藏为导读。
// 鉴权、限流与 CORS 与 link-preview 相同；缺 GLM_API_KEY 时返回 501，客户端按未配置降级。
const limits=new Map(),cache=new Map();
const ORIGINS=['https://wuhy80.github.io','http://127.0.0.1:4178','http://127.0.0.1:4179'];
const DOMAINS=['bilibili.com','b23.tv','youtube.com','youtu.be','linux.do','zhihu.com','zhihu.link','xiaohongshu.com','xhslink.com','douyin.com','iesdouyin.com','github.com'];
function allowed(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&DOMAINS.some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}}
async function limitedText(response,max=150000){const reader=response.body?.getReader();if(!reader)return '';const decoder=new TextDecoder();let out='';for(;;){const {done,value}=await reader.read();if(done)break;out+=decoder.decode(value,{stream:true});if(out.length>max){try{await reader.cancel();}catch{}break;}}return out+decoder.decode();}
async function describe(url){ // 尽力而为抓 OG 描述给模型补充上下文，失败静默跳过
 try{
  let current=url;
  for(let hop=0;hop<5;hop++){
   const response=await fetch(current,{redirect:'manual',headers:{'user-agent':'Mozilla/5.0 (compatible; ShiguangAI/1.0)','accept':'text/html,application/xhtml+xml','accept-language':'zh-CN,zh;q=0.9'},signal:AbortSignal.timeout(8000)});
   if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location||!allowed(location))return '';current=location;continue;}
   if(!response.ok)return '';
   const html=await limitedText(response);
   const match=key=>{for(const re of [new RegExp('<meta[^>]+(?:property|name)=["\']'+key+'["\'][^>]*content=["\']([^"\']*)["\']','i'),new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']'+key+'["\']','i')]){const found=html.match(re);if(found)return found[1];}const title=html.match(/<title[^>]*>([^<]*)<\/title>/i);return key==='description'&&title?title[1]:'';};
   const text=(match('og:description')||match('description')||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
   return text.slice(0,300);
  }
 }catch{}
 return '';
}
async function chat(messages,maxTokens){ // 缺 key 由调用方先行拦截；模型可用 GLM_MODEL 覆盖
 const response=await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+Deno.env.get('GLM_API_KEY')},body:JSON.stringify({model:Deno.env.get('GLM_MODEL')||'glm-4-flash',messages,temperature:0.3,max_tokens:maxTokens}),signal:AbortSignal.timeout(60000)});
 if(!response.ok){console.warn('chat_failed',response.status,(await response.text()).slice(0,300));throw Error('ai_unavailable');}
 const data=await response.json();const content=data?.choices?.[0]?.message?.content;
 if(typeof content!=='string'||!content.trim())throw Error('ai_unavailable');
 return content;
}
function extractJson(text){ // 模型偶尔包裹代码栅栏或前后缀说明，取首个平衡的花括号
 const clean=String(text).replace(/```(?:json)?/gi,'');const start=clean.indexOf('{');if(start<0)return null;
 let depth=0,inString=false,escape=false;
 for(let i=start;i<clean.length;i++){const c=clean[i];
  if(escape){escape=false;continue;}
  if(c==='\\'){escape=true;continue;}
  if(c==='"'){inString=!inString;continue;}
  if(inString)continue;
  if(c==='{')depth++;else if(c==='}'){depth--;if(!depth){try{return JSON.parse(clean.slice(start,i+1));}catch{return null;}}}
 }
 return null;
}
function digestPrompt(){return '你是个人知识库的回顾助手。用户给出近 7 天收藏清单（标题｜平台｜标签｜我的笔记），输出简短中文 markdown 导读，依次包含：## 收藏亮点（3-6 条，每条一句话点出内容价值）、## 建议优先读（最多 3 条，给出具体理由）、## 一句话总结。只能基于清单内容，不要编造清单外的信息，不要寒暄。';}
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const cors={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
 if(origin&&!ORIGINS.includes(origin))return new Response('Forbidden',{status:403});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 const json=(data,status=200)=>Response.json(data,{status,headers:{...cors,'Cache-Control':'no-store'}});
 if(req.method!=='POST')return json({error:'method'},405);
 try{
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))return json({error:'sign_in_required'},401);
  const auth=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{headers:{Authorization:authorization,apikey:Deno.env.get('SUPABASE_ANON_KEY')!},signal:AbortSignal.timeout(5000)});
  if(!auth.ok)return json({error:'sign_in_required'},401);const user=await auth.json();if(!user.id)return json({error:'sign_in_required'},401);
  const apiKey=Deno.env.get('GLM_API_KEY');if(!apiKey)return json({error:'ai_not_configured'},501);
  if(Number(req.headers.get('content-length'))>30000)return json({error:'too_large'},413);
  const raw=await req.text();if(raw.length>30000)return json({error:'too_large'},413);
  const body=JSON.parse(raw);const mode=body?.mode;
  if(mode==='enrich'){
   const {url,title,platform,tags,notes,author}=body;
   if(typeof url!=='string'||url.length>2000||typeof title!=='string'||!title.trim()||title.length>500)return json({error:'bad_request'},400);
   const now=Date.now(),limit=limits.get(user.id+':enrich');if(limit&&limit.until>now&&limit.count>=30)return json({error:'retry_later'},429);
   limits.set(user.id+':enrich',{count:limit?.until>now?limit.count+1:1,until:limit?.until>now?limit.until:now+60000});if(limits.size>2000)for(const [key,v] of limits)if(v.until<now)limits.delete(key);
   const tagList=Array.isArray(tags)?tags.filter(t=>typeof t==='string').slice(0,20):[];
   const key=url+'|'+title+'|'+tagList.join(',')+'|'+String(notes||'').slice(0,200);
   const cached=cache.get(key);if(cached&&cached.until>now)return json(cached.data);
   const context=['标题：'+title,'平台：'+(typeof platform==='string'?platform:'other'),typeof author==='string'&&author?'作者：'+author.slice(0,100):'',tagList.length?'已有标签：'+tagList.join('、'):'',typeof notes==='string'&&notes.trim()?'我的笔记：'+notes.slice(0,500):''].filter(Boolean).join('\n');
   const page=await describe(url);
   const content=await chat([{role:'system',content:'你是个人知识库的整理助手。根据用户提供的收藏信息输出严格的 JSON：{"summary":"不超过60字的中文一句话摘要，概括内容本身而不是夸赞收藏行为","tags":["2到5个中文标签，每个不超过12字，优先沿用已有标签的用词风格"]}。只输出 JSON，不要解释。'},{role:'user',content:context+(page?'\n网页简介：'+page:'')}],400);
   const parsed=extractJson(content);
   const summary=typeof parsed?.summary==='string'?parsed.summary.replace(/\s+/g,' ').trim().slice(0,120):'';
   const aiTags=Array.isArray(parsed?.tags)?parsed.tags.filter(t=>typeof t==='string').map(t=>t.replace(/^#/,'').replace(/\s+/g,' ').trim().slice(0,20)).filter(Boolean).filter((t,i,a)=>a.indexOf(t)===i).slice(0,5):[];
   if(!summary)return json({error:'ai_unavailable'},502);
   const data={summary,tags:aiTags};cache.set(key,{data,until:now+7*86400000});if(cache.size>300)cache.delete(cache.keys().next().value);
   return json(data);
  }
  if(mode==='digest'){
   const {items,unreadCount}=body;
   if(!Array.isArray(items)||!items.length||items.length>100)return json({error:'bad_request'},400);
   const now=Date.now(),limit=limits.get(user.id+':digest');if(limit&&limit.until>now&&limit.count>=6)return json({error:'retry_later'},429);
   limits.set(user.id+':digest',{count:limit?.until>now?limit.count+1:1,until:limit?.until>now?limit.until:now+60000});
   const lines=items.map((x,i)=>`${i+1}. ${String(x?.title||'').slice(0,120)}｜${String(x?.platform||'').slice(0,20)}｜${Array.isArray(x?.tags)?x.tags.slice(0,8).join('、'):''}${typeof x?.notes==='string'&&x.notes?'｜笔记：'+x.notes.slice(0,60):''}`);
   const content=await chat([{role:'system',content:digestPrompt()},{role:'user',content:`近 7 天新收藏 ${items.length} 条：\n${lines.join('\n')}\n另有 ${Number(unreadCount)||0} 条更早的待阅读未列入清单。`}],900);
   const digest=content.trim().slice(0,4000);if(!digest)return json({error:'ai_unavailable'},502);
   return json({digest});
  }
  return json({error:'bad_request'},400);
 }catch(error){console.warn('enrich_failed',error.message);return json({error:'ai_unavailable'},502);}
});
