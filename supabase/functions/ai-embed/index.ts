// 语义向量服务：把收藏文本转为 embedding-3 向量，只做向量、不落库。
// 鉴权、限流与 CORS 与 link-preview 相同；缺 GLM_API_KEY 时返回 501，客户端按未配置降级。
const limits=new Map();
const ORIGINS=['https://wuhy80.github.io','https://appassets.androidplatform.net','http://127.0.0.1:4178','http://127.0.0.1:4179'];
const MAX_BATCH=16,MAX_TEXT=1000;
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
  const now=Date.now(),limit=limits.get(user.id);if(limit&&limit.until>now&&limit.count>=30)return json({error:'retry_later'},429);
  limits.set(user.id,{count:limit?.until>now?limit.count+1:1,until:limit?.until>now?limit.until:now+60000});if(limits.size>1000)for(const [key,v] of limits)if(v.until<now)limits.delete(key);
  if(Number(req.headers.get('content-length'))>20000)return json({error:'too_large'},413);
  const raw=await req.text();if(raw.length>20000)return json({error:'too_large'},413);
  const {texts}=JSON.parse(raw);
  if(!Array.isArray(texts)||!texts.length||texts.length>MAX_BATCH||texts.some(t=>typeof t!=='string'||!t.trim()||t.length>MAX_TEXT))return json({error:'bad_request'},400);
  const dimensions=Number(Deno.env.get('GLM_EMBED_DIMS'))||256;
  const response=await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify({model:'embedding-3',input:texts,dimensions}),signal:AbortSignal.timeout(30000)});
  if(!response.ok){console.warn('embed_failed',response.status,(await response.text()).slice(0,300));return json({error:'ai_unavailable'},502);}
  const data=await response.json();
  const vectors=(Array.isArray(data?.data)?data.data:[]).sort((a,b)=>(a.index??0)-(b.index??0)).map(x=>x?.embedding);
  if(vectors.length!==texts.length||vectors.some(v=>!Array.isArray(v)||typeof v[0]!=='number'))return json({error:'ai_unavailable'},502);
  return json({embeddings:vectors,dims:vectors[0].length});
 }catch(error){console.warn('embed_failed',error.message);return json({error:'ai_unavailable'},502);}
});
