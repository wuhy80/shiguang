// Public metadata only. Every outbound redirect is checked against this allowlist.
const domains=['bilibili.com','b23.tv','youtube.com','youtu.be','linux.do','zhihu.com','zhihu.link','xiaohongshu.com','xhslink.com','douyin.com','iesdouyin.com','github.com'];
const douyinMobileUA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
export function allowed(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}}
export function imageUrl(value,base){if(!value)return "";try{const u=new URL(value,base);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';u.protocol='https:';return u.href.slice(0,2000);}catch{return '';}}
function decode(value){return value.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';});}
export function parseMeta(html,url){
 const values={};for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const attrs={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]??'');const key=(attrs.property||attrs.name||'').toLowerCase();if(attrs.content&&!values[key])values[key]=attrs.content;}
 return {url,thumbnail:imageUrl(values['og:image:secure_url']||values['og:image']||values['twitter:image']||values['twitter:image:src']||'',url),title:(values['og:title']||values['twitter:title']||decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||'')).trim().slice(0,500)};
}
// Douyin share pages embed the full item payload in window._ROUTER_DATA; plain meta tags stay empty.
export function parseDouyin(html){
 const match=html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
 if(!match)return null;
 let data;try{data=JSON.parse(match[1]);}catch{return null;}
 const item=data?.loaderData?.['video_(id)/page']?.videoInfoRes?.item_list?.[0];
 if(!item)return null;
 const thumbnail=(item.video?.cover?.url_list||[]).find(u=>typeof u==='string'&&u.startsWith('https://'))||'';
 const title=String(item.desc||'').replace(/\s+/g,' ').trim().slice(0,500);
 if(!title&&!thumbnail)return null;
 return {title,thumbnail,author:String(item.author?.nickname||'').slice(0,150)};
}
let ttwidToken='';
async function douyinMeta(id,fetcher){
 if(!ttwidToken){try{const response=await fetcher('https://ttwid.bytedance.com/ttwid/union/register/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({region:'cn',aid:1768,needFid:false,service:'www.ixigua.com',migrate_info:{ticket:'',source:'node'},cbUrlProtocol:'https',union:true}),signal:AbortSignal.timeout(5000)});ttwidToken=(response.headers.get('set-cookie')||'').match(/ttwid=([^;\s,]+)/)?.[1]||'';}catch{}}
 let target='https://www.iesdouyin.com/share/video/'+id;
 for(let i=0;i<3;i++){
  if(!allowed(target))throw Error('unsupported_redirect');
  const response=await fetcher(target,{redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'User-Agent':douyinMobileUA,'Accept':'text/html','Referer':'https://www.douyin.com/',...(ttwidToken?{Cookie:'ttwid='+ttwidToken}:{})}});
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');if(!next)break;target=new URL(next,target).href;continue;}
  if(!response.ok)return null;
  return parseDouyin(await limitedText(response));
 }
 return null;
}
async function limitedText(response){const reader=response.body?.getReader();if(!reader)return '';const chunks=[];let total=0;try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>1500000)break;chunks.push(value);}}finally{await reader.cancel();}const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return new TextDecoder().decode(bytes);}
export async function preview(value,fetcher=fetch){
 if(!allowed(value))throw Error('unsupported_url');
 let url=new URL(value).href;
 const request=async target=>{if(!allowed(target))throw Error('unsupported_redirect');return fetcher(target,{redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/json','Referer':'https://www.bilibili.com/'}});};
 for(let i=0;i<5;i++){
  const u=new URL(url),bv=u.hostname.endsWith('bilibili.com')&&u.pathname.match(/\/(BV[\da-zA-Z]+)(?:\/|$)/)?.[1];
  if(bv){try{const response=await request('https://api.bilibili.com/x/web-interface/view?bvid='+encodeURIComponent(bv));const data=JSON.parse(await limitedText(response));if(data.code===0&&data.data?.pic)return {url,thumbnail:imageUrl(data.data.pic,url),title:String(data.data.title||'').slice(0,500)};console.warn('preview_bilibili',response.status,data.code);}catch(error){console.warn('preview_bilibili',error.message);}}
  const dy=u.hostname.endsWith('douyin.com')||u.hostname.endsWith('iesdouyin.com'),did=dy&&u.pathname.match(/\/(?:share\/)?video\/(\d+)(?:\/|$)/)?.[1];
  if(did){try{const meta=await douyinMeta(did,fetcher);if(meta&&(meta.title||meta.thumbnail))return {url,thumbnail:imageUrl(meta.thumbnail,url),title:meta.title};console.warn('preview_douyin','no metadata for',did);}catch(error){console.warn('preview_douyin',error.message);}}
  const response=await request(url);
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');if(!next)break;url=new URL(next,url).href;if(!allowed(url))throw Error('unsupported_redirect');continue;}
  if(!response.ok)throw Error('upstream_unavailable');return parseMeta(await limitedText(response),url);
 }
 return {url,thumbnail:'',title:''};
}
