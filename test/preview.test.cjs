const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const SG=require('../dist/core.js');

test('thumbnail survives normalize, backup and cloud merge; unsafe images rejected',()=>{
 const input={url:'https://www.bilibili.com/video/BV123',thumbnail:'https://i0.hdslb.com/bfs/archive/test.jpg'};
 assert.equal(SG.normalize(input).thumbnail,input.thumbnail);
 assert.equal(SG.parseFile(JSON.stringify([input]),'backup.json')[0].thumbnail,input.thumbnail);
 for(const url of ['javascript:alert(1)','http://example.com/img.jpg','https://127.0.0.1/a','https://10.1.2.3/a','https://user:pass@example.com/a'])assert.equal(SG.safeImage(url),'');
 assert.equal(SG.thumbnailFor({url:'https://youtu.be/fNk_zzaMoSs'}),'https://wsrv.nl/?url=i.ytimg.com%2Fvi%2FfNk_zzaMoSs%2Fhqdefault.jpg&w=480&output=jpg');
 assert.equal(SG.thumbnailFor({url:'https://fake-youtube.com/watch?v=fNk_zzaMoSs'}),'');
});
test('metadata parser accepts varied OG attribute order and rejects outbound private hosts and redirect escapes',async()=>{
 const {parseMeta,allowed,preview}=await import('../supabase/functions/link-preview/preview.mjs');
 const result=parseMeta(`<meta content='https://cdn.example.com/a.jpg?a=1&amp;b=2' property='og:image'><meta property="og:title" content="原视频 &amp; 标题">`,'https://linux.do/t/topic/123');
 assert.equal(result.thumbnail,'https://cdn.example.com/a.jpg?a=1&b=2');assert.equal(result.title,'原视频 & 标题');
 assert.equal(parseMeta('<title>无封面</title>','https://linux.do').thumbnail,'');
 for(const url of ['https://127.0.0.1','http://linux.do','https://linux.do.evil.com','https://user@linux.do','https://linux.do:1234'])assert.equal(allowed(url),false);
 let calls=0;await assert.rejects(preview('https://b23.tv/test',async()=>{calls++;return new Response('',{status:302,headers:{location:'http://169.254.169.254/latest'}});}),/unsupported_redirect/);assert.equal(calls,1);
 const data=await preview('https://www.bilibili.com/video/BV123',async url=>{assert.match(url,/api.bilibili.com/);return Response.json({code:0,data:{pic:'http://i0.hdslb.com/test.jpg',title:'原视频'}});});assert.equal(data.thumbnail,'https://i0.hdslb.com/test.jpg');
});
test('Douyin share SSR data is parsed and collection modal links resolve through the cloud preview',async()=>{
 const {parseDouyin,preview}=await import('../supabase/functions/link-preview/preview.mjs');
 assert.equal(parseDouyin('<html>no data</html>'),null);
 const router=JSON.stringify({loaderData:{'video_(id)/page':{videoInfoRes:{item_list:[{aweme_id:'7617464281105321235',desc:'  梯度下降——模型如何自己学会找最优参数  #梯度下降  ',author:{nickname:'谦行AIing'},video:{cover:{url_list:['http://p3.douyinpic.com/a.webp','https://p5.douyinpic.com/b.webp?x=1']}}}]}}}});
 const html=`<html><script>window._ROUTER_DATA = ${router} </script></html>`;
 assert.deepEqual({t:parseDouyin(html).title,c:parseDouyin(html).thumbnail},{t:'梯度下降——模型如何自己学会找最优参数 #梯度下降',c:'https://p5.douyinpic.com/b.webp?x=1'});
 const requests=[];
 const body=bytes=>({getReader(){let done=false;return{read(){if(done)return Promise.resolve({done:true,value:null});done=true;return Promise.resolve({done:false,value:new TextEncoder().encode(bytes)});},cancel(){}}}});
 const stub=(url,options={})=>{requests.push(String(url));if(String(url).includes('ttwid'))return Promise.resolve({ok:true,status:200,headers:new Map([['set-cookie','ttwid=abc123; Path=/']]),body:body('')});return Promise.resolve({ok:true,status:200,headers:new Map(),body:body(html)});};
 const result=await preview('https://www.douyin.com/video/7617464281105321235',stub);
 assert.equal(result.title,'梯度下降——模型如何自己学会找最优参数 #梯度下降');assert.equal(result.thumbnail,'https://p5.douyinpic.com/b.webp?x=1');
 assert.ok(requests.some(u=>u.includes('iesdouyin.com/share/video/7617464281105321235')));
});

test('bilibili favlists and youtube playlists resolve with episode lists',async()=>{
 const {preview}=await import('../supabase/functions/link-preview/preview.mjs');
 const body=bytes=>({getReader(){let done=false;return{read(){if(done)return Promise.resolve({done:true,value:null});done=true;return Promise.resolve({done:false,value:new TextEncoder().encode(bytes)});},cancel(){}}}});
 const stub=url=>{
  url=String(url);
  if(url.includes('/x/v3/fav/resource/list'))return Promise.resolve({ok:true,status:200,headers:new Map(),body:body(JSON.stringify({code:0,data:{info:{title:'前端学习路线'},medias:[{bvid:'BV1xx411c7mD',title:'第一集 HTML',cover:'https://i0.hdslb.com/a.jpg'},{bvid:'BV1yf411q7ok',title:'第二集 CSS',cover:'https://i0.hdslb.com/b.jpg'}]}}))});
  if(url.includes('oembed'))return Promise.resolve({ok:true,status:200,headers:new Map(),body:body(JSON.stringify({title:'My Playlist',author_name:'Someone',thumbnail_url:'https://i.ytimg.com/pl.jpg'}))});
  if(url.includes('feeds/videos.xml'))return Promise.resolve({ok:true,status:200,headers:new Map(),body:body('<feed><entry><yt:videoId>abc123_-xYz</yt:videoId><title>Episode 1</title><media:thumbnail url="https://i.ytimg.com/v1.jpg"/></entry><entry><yt:videoId>def456_-xYz</yt:videoId><title>Episode 2</title></entry></feed>')});
  return Promise.resolve({ok:false,status:404,headers:new Map(),body:body('')});
 };
 const fav=await preview('https://space.bilibili.com/946974/favlist?fid=777',stub);
 assert.equal(fav.title,'前端学习路线');assert.equal(fav.episodes.length,2);
 assert.equal(fav.episodes[0].url,'https://www.bilibili.com/video/BV1xx411c7mD');assert.equal(fav.episodes[0].thumbnail,'https://i0.hdslb.com/a.jpg');
 const yt=await preview('https://www.youtube.com/playlist?list=PLtest12345678',stub);
 assert.equal(yt.title,'My Playlist');assert.equal(yt.episodes.length,2);assert.equal(yt.episodes[0].url,'https://www.youtube.com/watch?v=abc123_-xYz');
});

test('single youtube videos resolve through oEmbed even when the page is bot-walled',async()=>{
 const {preview}=await import('../supabase/functions/link-preview/preview.mjs');
 const body=bytes=>({getReader(){let done=false;return{read(){if(done)return Promise.resolve({done:true,value:null});done=true;return Promise.resolve({done:false,value:new TextEncoder().encode(bytes)});},cancel(){}}}});
 const stub=url=>{
  url=String(url);
  if(url.includes('oembed'))return Promise.resolve({ok:true,status:200,headers:new Map(),body:body(JSON.stringify({title:'The Essence of Linear Algebra',author_name:'3Blue1Brown',thumbnail_url:'https://wsrv.nl/?url=i.ytimg.com%2Fvi%2FfNk_zzaMoSs%2Fhqdefault.jpg&w=480&output=jpg'}))});
  return Promise.resolve({ok:true,status:200,headers:new Map(),body:body('<html><head><title>Sign in to confirm you are not a bot</title></head></html>')});
 };
 for(const url of ['https://www.youtube.com/watch?v=fNk_zzaMoSs&vd_source=x','https://youtu.be/fNk_zzaMoSs','https://www.youtube.com/shorts/fNk_zzaMoSs']){
  const meta=await preview(url,stub);
  assert.equal(meta.title,'The Essence of Linear Algebra');
  assert.equal(meta.thumbnail,'https://wsrv.nl/?url=i.ytimg.com%2Fvi%2FfNk_zzaMoSs%2Fhqdefault.jpg&w=480&output=jpg');
 }
});
