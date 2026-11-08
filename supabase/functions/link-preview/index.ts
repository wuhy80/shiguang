import { preview, allowed } from './preview.mjs';
const cache=new Map(),limits=new Map();
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const cors={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
 if(origin&&!['https://wuhy80.github.io','https://appassets.androidplatform.net','http://127.0.0.1:4178','http://127.0.0.1:4179'].includes(origin))return new Response('Forbidden',{status:403});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 const json=(data,status=200)=>Response.json(data,{status,headers:{...cors,'Cache-Control':'no-store'}});
 if(req.method!=='POST')return json({error:'method'},405);
 try{
  const authorization=req.headers.get('authorization')||'';if(!authorization.startsWith('Bearer '))return json({error:'sign_in_required'},401);
  const auth=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{headers:{Authorization:authorization,apikey:Deno.env.get('SUPABASE_ANON_KEY')!},signal:AbortSignal.timeout(5000)});
  if(!auth.ok)return json({error:'sign_in_required'},401);const user=await auth.json();if(!user.id)return json({error:'sign_in_required'},401);
  const now=Date.now(),limit=limits.get(user.id);if(limit&&limit.until>now&&limit.count>=60)return json({error:'retry_later'},429);
  limits.set(user.id,{count:limit?.until>now?limit.count+1:1,until:limit?.until>now?limit.until:now+60000});if(limits.size>1000)for(const [key,v] of limits)if(v.until<now)limits.delete(key);
  if(Number(req.headers.get('content-length'))>5000)return json({error:'too_large'},413);
  const raw=await req.text();if(raw.length>5000)return json({error:'too_large'},413);const {url}=JSON.parse(raw);if(typeof url!=='string'||url.length>2000||!allowed(url))return json({error:'unsupported_url'},400);
  const cached=cache.get(url);if(cached&&cached.until>now)return json(cached.data);
  const data=await preview(url);cache.set(url,{data,until:now+86400000});if(cache.size>500)cache.delete(cache.keys().next().value);return json(data);
 }catch(error){console.warn('preview_failed',error.message);return json({error:'preview_unavailable'},502);}
});
