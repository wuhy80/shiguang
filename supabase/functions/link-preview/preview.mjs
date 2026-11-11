// Public metadata only. Every outbound redirect is checked against this allowlist.
const domains=['bilibili.com','b23.tv','youtube.com','youtu.be','linux.do','zhihu.com','zhihu.link','xiaohongshu.com','xhslink.com','douyin.com','iesdouyin.com','github.com'];
const douyinMobileUA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
export function allowed(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}}
// 开放抓取任意 https 站点后的 SSRF 硬化：拦截私网/保留地址（含云元数据端点），域名需解析为公网地址才放行。
function isPrivateIp(ip){
 if(ip.startsWith('['))ip=ip.slice(1,-1);
 if(ip.includes(':')){const lower=ip.toLowerCase();const mapped=lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);if(mapped)return isPrivateIp(mapped[1]);return lower==='::'||lower==='::1'||/^(?:fe[89ab]|f[cd])[0-9a-f]*:/.test(lower);}
 const parts=ip.split('.');if(parts.length!==4||parts.some(p=>!/^\d{1,3}$/.test(p)||Number(p)>255))return true;
 const [a,b]=parts.map(Number);
 return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19))||a>=224;
}
function unreachableHost(u){
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))return true;
 const h=u.hostname.toLowerCase();
 if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.home.arpa'))return true;
 return /^(\d{1,3}\.){3}\d{1,3}$/.test(h)||h.startsWith('[')?isPrivateIp(h):false;
}
async function dohResolve(hostname){
 const ask=async base=>{const response=await fetch(base+encodeURIComponent(hostname)+'&type=A',{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('doh_unavailable');return (await response.json()).Answer||[];};
 let records=[];
 for(const base of ['https://cloudflare-dns.com/dns-query?name=','https://dns.google/resolve?name=']){try{records=await ask(base);break;}catch{}}
 if(!records.length)throw Error('doh_unavailable');
 return records.filter(x=>x.type===1&&typeof x.data==='string').map(x=>x.data);
}
const resolvedCache=new Map();
async function hostIsPublic(hostname,dns){
 const now=Date.now(),cached=resolvedCache.get(hostname);
 if(cached&&cached.until>now)return cached.ok;
 let ok;try{const ips=await dns(hostname);ok=Array.isArray(ips)&&ips.length>0&&!ips.some(isPrivateIp);}catch{ok=false;}
 resolvedCache.set(hostname,{ok,until:now+300000});if(resolvedCache.size>500)resolvedCache.delete(resolvedCache.keys().next().value);
 return ok;
}
export async function publiclyFetchable(value,dns){
 try{
  const u=new URL(value);if(unreachableHost(u))return false;
  const h=u.hostname.toLowerCase();
  if(domains.some(d=>h===d||h.endsWith('.'+d)))return true; // 已知平台免解析，保持原有可用性
  if(!dns)dns=dohResolve;
  return await hostIsPublic(h,dns);
 }catch{return false;}
}
export function imageUrl(value,base){if(!value)return "";try{const u=new URL(value,base);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';u.protocol='https:';return u.href.slice(0,2000);}catch{return '';}}
function decode(value){return value.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';});}
export function parseMeta(html,url){
 const values={};for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const attrs={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]??'');const key=(attrs.property||attrs.name||'').toLowerCase();if(attrs.content&&!values[key])values[key]=attrs.content;}
 const icon=()=>{for(const tag of html.match(/<link\b[^>]*>/gi)||[]){const attrs={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]??'');const rel=String(attrs.rel||'').toLowerCase().split(/\s+/);if(!attrs.href)continue;if(rel.includes('apple-touch-icon'))return attrs.href;const declared=Math.max(0,...[...String(attrs.sizes||'').matchAll(/(\d+)\s*x\s*(\d+)/gi)].flatMap(m=>[Number(m[1]),Number(m[2])]));if(rel.includes('icon')&&declared>=96)return attrs.href;}return '';};
 return {url,thumbnail:imageUrl(values['og:image:secure_url']||values['og:image']||values['twitter:image']||values['twitter:image:src']||icon(),url),title:(values['og:title']||values['twitter:title']||decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||'')).trim().slice(0,500)};
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
async function limitedText(response){const reader=response.body?.getReader();if(!reader)return '';const chunks=[];let total=0;try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>1500000)break;chunks.push(value);}}finally{await reader.cancel();}const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return decodeBytes(bytes,response.headers.get('content-type'));}
// 编码探测：HTTP 头 charset 优先，其次页面 meta 声明，都没有才按 UTF-8。GBK/GB18030 等老站点不再乱码。
function decodeBytes(bytes,contentTypes){
 const headerCharset=/charset\s*=\s*"?([\w-]+)"?/i.exec(contentTypes||'')?.[1];
 const probe=new TextDecoder('latin1').decode(bytes.slice(0,2048)).toLowerCase();
 const metaCharset=/charset\s*=\s*["']?\s*([\w-]+)/i.exec(probe)?.[1];
 for(const label of [headerCharset,metaCharset]){
  if(!label||/^(utf-?8|us-ascii|latin1|iso-8859-1)$/i.test(label))continue;
  try{return new TextDecoder(label.replace(/_/g,'-')).decode(bytes);}catch{}
 }
 return new TextDecoder('utf-8').decode(bytes);
}
async function apiJSON(target,fetcher,headers={}){
 if(!allowed(target))throw Error('unsupported_redirect');
 const response=await fetcher(target,{redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/xml',...headers}});
 if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');if(next&&allowed(new URL(next,target).href))return apiJSON(new URL(next,target).href,fetcher,headers);throw Error('unsupported_redirect');}
 if(!response.ok)throw Error('upstream_unavailable');
 const text=await limitedText(response);try{return JSON.parse(text);}catch{return null;}
}
function episodeOut(episodes){return episodes.filter(e=>e&&e.url).slice(0,50);}
async function bilibiliCollection(u,fetcher){
 const referer={'Referer':'https://space.bilibili.com/'};
 const mid=u.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1],fid=u.pathname.includes('/favlist')&&u.searchParams.get('fid');
 const season=u.pathname.includes('/channel/collectiondetail')&&u.searchParams.get('sid');
 const series=u.pathname.includes('/channel/seriesdetail')&&u.searchParams.get('sid');
 let title='',thumbnail='',episodes=[];
 if(fid){
  const data=await apiJSON('https://api.bilibili.com/x/v3/fav/resource/list?media_id='+encodeURIComponent(fid)+'&pn=1&ps=50',fetcher,{'Referer':'https://www.bilibili.com/'});
  const info=data?.data?.info||{};
  title=String(info.title||'').trim();
  episodes=episodeOut((data?.data?.medias||[]).filter(m=>m&&m.bvid).map(m=>({url:'https://www.bilibili.com/video/'+m.bvid,title:String(m.title||''),thumbnail:imageUrl(m.cover||m.pic||'','https://www.bilibili.com/')})));
 }else if(season&&mid){
  const data=await apiJSON('https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid='+encodeURIComponent(mid)+'&season_id='+encodeURIComponent(season)+'&page_num=1&page_size=50',fetcher,referer);
  const meta=data?.data?.meta||{};
  title=String(meta.name||'').trim();
  thumbnail=imageUrl(meta.image||'','https://space.bilibili.com/');
  episodes=episodeOut((data?.data?.archives||[]).filter(a=>a&&a.bvid).map(a=>({url:'https://www.bilibili.com/video/'+a.bvid,title:String(a.title||''),thumbnail:imageUrl(a.pic||'','https://space.bilibili.com/')})));
 }else if(series&&mid){
  const data=await apiJSON('https://api.bilibili.com/x/series/archives?mid='+encodeURIComponent(mid)+'&series_id='+encodeURIComponent(series)+'&pn=1&ps=50',fetcher,referer);
  const meta=data?.data?.meta||{};
  title=String(meta.name||'').trim();
  episodes=episodeOut((data?.data?.archives||[]).filter(a=>a&&a.bvid).map(a=>({url:'https://www.bilibili.com/video/'+a.bvid,title:String(a.title||''),thumbnail:imageUrl(a.pic||'','https://space.bilibili.com/')})));
 }else return null;
 if(!title&&!episodes.length)return null;
 return {title,thumbnail:thumbnail||episodes[0]?.thumbnail||'',episodes};
}
async function youtubePlaylist(lid,fetcher){
 let title='',thumbnail='',episodes=[];
 try{
  const data=await apiJSON('https://www.youtube.com/oembed?format=json&url='+encodeURIComponent('https://www.youtube.com/playlist?list='+lid),fetcher);
  title=String(data?.title||'').trim();thumbnail=String(data?.thumbnail_url||'');
 }catch{}
 try{
  if(!allowed('https://www.youtube.com/feeds/videos.xml?playlist_id='+encodeURIComponent(lid)))throw Error('unsupported_redirect');
  const response=await fetcher('https://www.youtube.com/feeds/videos.xml?playlist_id='+encodeURIComponent(lid),{redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'User-Agent':'Mozilla/5.0','Accept':'application/xml,text/xml'}});
  if(response.ok){
   const xml=await limitedText(response);
   for(const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g)||[]){
    if(episodes.length>=50)break;
    const vid=entry.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/)?.[1]||entry.match(/<link[^>]*href="[^"]*?[?&]v=([\w-]+)"/)?.[1];
    const entryTitle=decode(entry.match(/<title>([^<]*)<\/title>/)?.[1]||'').trim();
    const img=entry.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1]||'';
    if(vid)episodes.push({url:'https://www.youtube.com/watch?v='+vid,title:entryTitle,thumbnail:img});
   }
  }
 }catch{}
 if(!title&&!episodes.length)return null;
 return {title:title||(episodes[0]?episodes[0].title:''),thumbnail:imageUrl(thumbnail||episodes[0]?.thumbnail||'','https://www.youtube.com/'),episodes};
}
export async function preview(value,fetcher=fetch,dns){
 if(!await publiclyFetchable(value,dns))throw Error('unsupported_url');
 let url=new URL(value).href;
 const request=async target=>{if(!await publiclyFetchable(target,dns))throw Error('unsupported_redirect');return fetcher(target,{redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/json'}});};
 for(let i=0;i<5;i++){
  const u=new URL(url),bv=u.hostname.endsWith('bilibili.com')&&u.pathname.match(/\/(BV[\da-zA-Z]+)(?:\/|$)/)?.[1];
  if(bv){try{const response=await request('https://api.bilibili.com/x/web-interface/view?bvid='+encodeURIComponent(bv));const data=JSON.parse(await limitedText(response));if(data.code===0&&data.data?.pic)return {url,thumbnail:imageUrl(data.data.pic,url),title:String(data.data.title||'').slice(0,500)};console.warn('preview_bilibili',response.status,data.code);}catch(error){console.warn('preview_bilibili',error.message);}}
  const dy=u.hostname.endsWith('douyin.com')||u.hostname.endsWith('iesdouyin.com'),did=dy&&u.pathname.match(/\/(?:share\/)?video\/(\d+)(?:\/|$)/)?.[1];
  if(did){try{const meta=await douyinMeta(did,fetcher);if(meta&&(meta.title||meta.thumbnail))return {url,thumbnail:imageUrl(meta.thumbnail,url),title:meta.title};console.warn('preview_douyin','no metadata for',did);}catch(error){console.warn('preview_douyin',error.message);}}
  if(u.hostname.endsWith('bilibili.com')&&(u.pathname.includes('/favlist')||u.pathname.includes('/channel/collectiondetail')||u.pathname.includes('/channel/seriesdetail'))){
   try{const meta=await bilibiliCollection(u,fetcher);if(meta)return {...meta,url};console.warn('preview_bilibili_collection','no metadata');}catch(error){console.warn('preview_bilibili_collection',error.message);}
  }
  if(u.hostname.endsWith('youtube.com')||u.hostname==='youtu.be'){
   const vid=u.pathname==='/watch'&&/^[\w-]{6,}$/.test(u.searchParams.get('v')||'')?u.searchParams.get('v'):u.hostname==='youtu.be'&&/^[\w-]{6,}$/.test(u.pathname.slice(1))?u.pathname.slice(1):u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})(?:\/|$)/)?.[1];
   if(vid){try{const data=await apiJSON('https://www.youtube.com/oembed?format=json&url='+encodeURIComponent('https://www.youtube.com/watch?v='+vid),fetcher);if(data?.title)return {url,thumbnail:imageUrl(data.thumbnail_url||'',url),title:String(data.title).trim()};console.warn('preview_youtube_video','no metadata');}catch(error){console.warn('preview_youtube_video',error.message);}}
  }
  if(u.hostname.endsWith('youtube.com')&&u.pathname==='/playlist'){
   const lid=u.searchParams.get('list');
   if(lid&&/^[\w-]{12,}$/.test(lid)){try{const meta=await youtubePlaylist(lid,fetcher);if(meta)return {...meta,url};console.warn('preview_youtube_playlist','no metadata');}catch(error){console.warn('preview_youtube_playlist',error.message);}}
  }
  const response=await request(url);
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');if(!next)break;url=new URL(next,url).href;if(!await publiclyFetchable(url,dns))throw Error('unsupported_redirect');continue;}
  if(!response.ok)throw Error('upstream_unavailable');const meta=parseMeta(await limitedText(response),url);return /验证码|安全验证|captcha|verify|not a bot/i.test(meta.title)?{url,thumbnail:'',title:''}:meta;
 }
 return {url,thumbnail:'',title:''};
}
