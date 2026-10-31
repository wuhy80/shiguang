const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const SG=require('../dist/core.js'),Capture=require('../dist/capture-store.js');

test('Android fetches public Bilibili metadata on the phone without requiring a cloud session',async()=>{
 const page={window:null,SG,URL,setTimeout,clearTimeout,ShiguangPreviewNative:{postMessage(raw){const data=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:data.id,thumbnail:'https://i0.hdslb.com/test.jpg',title:'视频'})}));}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/preview-client.js','utf8'),page);
 const result=await page.ShiguangPreview.fetch({url:'https://www.bilibili.com/video/BV123'});assert.equal(result.thumbnail,'https://i0.hdslb.com/test.jpg');assert.equal(result.title,'视频');
});

test('Zhihu Douyin and YouTube use native title fetching even when YouTube already has a derived cover',async()=>{
 const calls=[];const page={window:null,SG,URL,setTimeout,clearTimeout,ShiguangPreviewNative:{postMessage(raw){const data=JSON.parse(raw);calls.push(data.url);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:data.id,title:'原内容标题',thumbnail:'https://example.com/cover.jpg'})}));}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/preview-client.js','utf8'),page);
 for(const url of ['https://zhihu.link/abc','https://v.douyin.com/abc/','https://youtu.be/AbC123_-xyZ']){
  const item=SG.normalize({url}),meta=await page.ShiguangPreview.fetch(item);assert.equal(meta.title,'原内容标题');assert.equal(calls.at(-1),item.url);
 }
});

test('YouTube retains its derived cover if native title lookup cannot return metadata',async()=>{
 const page={window:null,SG,URL,setTimeout,clearTimeout,ShiguangPreviewNative:{postMessage(raw){const data=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:data.id})}));}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/preview-client.js','utf8'),page);
 const meta=await page.ShiguangPreview.fetch(SG.normalize({url:'https://youtu.be/AbC123_-xyZ'}));assert.equal(meta.thumbnail,'https://i.ytimg.com/vi/AbC123_-xyZ/hqdefault.jpg');
});

test('Xiaohongshu cn short links use phone metadata while signed out and repair only missing metadata',async()=>{
 let called='';const page={window:null,SG,URL,setTimeout,clearTimeout,ShiguangPreviewNative:{postMessage(raw){const data=JSON.parse(raw);called=data.url;queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:data.id,thumbnail:'https://sns-webpic-qc.xhscdn.com/note.jpg',title:'建议研一开始准备小论文'})}));}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/preview-client.js','utf8'),page);
 const item={url:'https://xhslink.cn/o/ABC123',title:'xhslink.cn',tags:['提升方向'],notes:'我的原因'};
 assert.equal(page.ShiguangPreview.supported(item.url),true);
 const meta=await page.ShiguangPreview.fetch(item);assert.equal(called,item.url);
 assert.equal(page.ShiguangPreview.apply(item,meta),true);assert.equal(item.title,'建议研一开始准备小论文');assert.equal(item.thumbnail,meta.thumbnail);assert.deepEqual(item.tags,['提升方向']);assert.equal(item.notes,'我的原因');
 item.title='我自己修改的标题';assert.equal(page.ShiguangPreview.apply(item,{title:'另一个标题',thumbnail:'https://example.com/other.jpg'}),false);assert.equal(item.title,'我自己修改的标题');
 const titleOnly={url:item.url,title:'xhslink.cn',thumbnail:meta.thumbnail};assert.equal(page.ShiguangPreview.apply(titleOnly,{title:meta.title}),true);assert.equal(titleOnly.title,meta.title);
});

test('mobile save commits immediately and completes metadata after the editor is dismissed',async()=>{
 let raw='[]',finish;const elements={},reports=[];
 const page={window:null,SG,ShiguangCapture:Capture,ShiguangCloud:{ready:Promise.resolve(),sync:async()=>({signedIn:true,pending:0})},ShiguangPreview:{needsTitle:item=>!item.title||item.title===new URL(item.url).hostname,fetch:()=>new Promise(resolve=>finish=resolve)},ShiguangQuickResult:{postMessage:text=>reports.push(JSON.parse(text))},localStorage:{getItem:key=>key===Capture.KEY?raw:null,setItem:(k,v)=>raw=v},setTimeout:()=>{},document:{getElementById:id=>elements[id]??={}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/share-form.js','utf8'),page);
 page.shiguangReceiveShare({url:'https://xhslink.cn/o/ABC123',title:'xhslink.cn'});
 await page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_GET'});
 const saving=page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_SAVE',tags:'提升方向',reason:'准备论文'});
 await Promise.resolve();assert.equal(JSON.parse(raw).length,1);assert.equal(reports[0].saved,true);assert.equal(JSON.parse(raw)[0].notes,'准备论文');
 finish({title:'笔记真实标题',thumbnail:'https://sns-webpic-qc.xhscdn.com/note.jpg'});await saving;
 const saved=JSON.parse(raw)[0];assert.equal(saved.title,'笔记真实标题');assert.equal(saved.thumbnail,'https://sns-webpic-qc.xhscdn.com/note.jpg');assert.deepEqual(saved.tags,['提升方向']);assert.equal(saved.notes,'准备论文');
});
test('thumbnail survives normalize, backup and cloud merge; unsafe images rejected',()=>{
 const input={url:'https://www.bilibili.com/video/BV123',thumbnail:'https://i0.hdslb.com/bfs/archive/test.jpg'};
 assert.equal(SG.normalize(input).thumbnail,input.thumbnail);
 assert.equal(SG.parseFile(JSON.stringify([input]),'backup.json')[0].thumbnail,input.thumbnail);
 for(const url of ['javascript:alert(1)','http://example.com/img.jpg','https://127.0.0.1/a','https://10.1.2.3/a','https://user:pass@example.com/a'])assert.equal(SG.safeImage(url),'');
 assert.equal(SG.thumbnailFor({url:'https://youtu.be/fNk_zzaMoSs'}),'https://i.ytimg.com/vi/fNk_zzaMoSs/hqdefault.jpg');
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
test('mobile share waits for confirmation and preserves categories, optional reason and cover',async()=>{
 let raw=JSON.stringify([{url:'https://example.com/existing',title:'已有',tags:['机器人']}]);const reports=[],elements={};
 const page={window:null,SG,ShiguangCapture:Capture,ShiguangCloud:{ready:Promise.resolve(),sync:async()=>({signedIn:true,pending:0})},ShiguangPreview:{needsTitle:item=>!item.title||item.title===new URL(item.url).hostname,fetch:async()=>({})},ShiguangQuickResult:{postMessage:text=>reports.push(JSON.parse(text))},localStorage:{getItem:key=>key===Capture.KEY?raw:null,setItem:(k,v)=>raw=v},setTimeout:()=>{},document:{getElementById:id=>elements[id]??={}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/share-form.js','utf8'),page);
 page.shiguangReceiveShare({url:'https://www.bilibili.com/video/BV123',title:'视频',thumbnail:'https://i0.hdslb.com/test.jpg'});
 assert.equal(elements.platform.textContent,'来源：哔哩哔哩');
 const response=await page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_GET'});assert.deepEqual([...response.tags],['机器人']);assert.equal(JSON.parse(raw).length,1);
 await page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_SAVE',tags:'机器人，新分类',reason:''});
 const saved=JSON.parse(raw)[0];assert.deepEqual(saved.tags,['机器人','新分类']);assert.equal(saved.notes,'');assert.equal(saved.thumbnail,'https://i0.hdslb.com/test.jpg');assert.equal(reports[0].saved,true);assert.equal(reports[1].cloud,true);
});
test('mobile share reports no success when durable storage fails',async()=>{
 const reports=[],page={window:null,SG,ShiguangCapture:Capture,ShiguangCloud:{ready:Promise.resolve()},ShiguangPreview:{needsTitle:item=>!item.title||item.title===new URL(item.url).hostname,fetch:async()=>({})},ShiguangQuickResult:{postMessage:text=>reports.push(text)},document:{getElementById:()=>({})},localStorage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}};page.window=page;vm.createContext(page);vm.runInContext(fs.readFileSync('dist/share-form.js','utf8'),page);page.shiguangReceiveShare({url:'https://example.com'});await page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_GET'});
 await assert.rejects(page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_SAVE'}),/quota/);assert.equal(reports.length,0);
});


test('YouTube title-only native response and cloud failure retain the original video cover',async()=>{
 const page={window:null,SG,URL,setTimeout,clearTimeout,ShiguangPreviewNative:{postMessage(raw){const data=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:data.id,title:'Video title'})}));}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/preview-client.js','utf8'),page);
 const item=SG.normalize({url:'https://www.youtube.com/shorts/AbC123_-xyZ'});
 let meta=await page.ShiguangPreview.fetch(item);assert.equal(meta.title,'Video title');assert.equal(meta.thumbnail,'https://i.ytimg.com/vi/AbC123_-xyZ/hqdefault.jpg');
 delete page.ShiguangPreviewNative;page.ShiguangCloud={ready:Promise.resolve(),client:{auth:{getSession:async()=>{throw Error('offline')}}}};
 meta=await page.ShiguangPreview.fetch(item);assert.equal(meta.thumbnail,'https://i.ytimg.com/vi/AbC123_-xyZ/hqdefault.jpg');
});

test('mobile YouTube save persists its cover before lookup and preserves a meaningful shared title',async()=>{
 let raw='[]';const elements={};
 const page={window:null,SG,ShiguangCapture:Capture,ShiguangCloud:{ready:Promise.resolve(),sync:async()=>({})},ShiguangPreview:{needsTitle:()=>false,fetch:async()=>({title:'YouTube'})},ShiguangQuickResult:{postMessage(){}},localStorage:{getItem:key=>key===Capture.KEY?raw:null,setItem:(k,v)=>raw=v},setTimeout:()=>{},document:{getElementById:id=>elements[id]??={}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/share-form.js','utf8'),page);
 page.shiguangReceiveShare({url:'https://youtu.be/AbC123_-xyZ',title:'Actual shared title'});
 await page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_GET'});await page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_SAVE',tags:'Videos'});
 const saved=JSON.parse(raw)[0];assert.equal(saved.title,'Actual shared title');assert.equal(saved.thumbnail,'https://i.ytimg.com/vi/AbC123_-xyZ/hqdefault.jpg');
});


test('native title is delivered immediately while missing cover is fetched, and survives cloud errors',async()=>{
 let reply,partial;
 const page={window:null,SG,URL,setTimeout,clearTimeout,AbortSignal,ShiguangCloudConfig:{url:'https://example.com',key:'test'},ShiguangCloud:{ready:Promise.resolve(),client:{auth:{getSession:async()=>({data:{session:{access_token:'test'}}})}}},fetch:()=>new Promise(resolve=>reply=resolve),ShiguangPreviewNative:{postMessage(raw){const data=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:data.id,title:'实际原文标题'})}));}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/preview-client.js','utf8'),page);
 const item=SG.normalize({url:'https://v.douyin.com/abc/'}),pending=page.ShiguangPreview.fetch(item,meta=>partial=meta);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(partial.title,'实际原文标题');assert.equal(typeof reply,'function');
 reply(Response.json({thumbnail:'https://cdn.example.com/original.jpg'}));const meta=await pending;
 assert.equal(meta.title,'实际原文标题');assert.equal(meta.thumbnail,'https://cdn.example.com/original.jpg');
 page.fetch=async()=>{throw Error('offline')};const fallback=await page.ShiguangPreview.fetch(item);assert.equal(fallback.title,'实际原文标题');
});


test('YouTube short-link hostname is still a placeholder after canonicalization and existing saves can be repaired',async()=>{
 let calls=0;const page={window:null,SG,URL,setTimeout,clearTimeout,ShiguangPreviewNative:{postMessage(raw){calls++;const data=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:data.id,title:'Actual original video title'})}));}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/preview-client.js','utf8'),page);
 const item=SG.normalize({url:'https://youtu.be/7-io63CTbeM',title:'youtu.be',tags:['test'],notes:'keep this reason'});
 assert.match(item.url,/youtube.com/);assert.equal(page.ShiguangPreview.needsTitle(item),true);
 const meta=await page.ShiguangPreview.fetch(item);assert.equal(calls,1);assert.equal(page.ShiguangPreview.apply(item,meta),true);assert.equal(item.title,'Actual original video title');assert.match(item.thumbnail,/7-io63CTbeM/);
 let raw=JSON.stringify([{...item,title:'youtu.be'}]);const storage={getItem:()=>raw,setItem:(k,v)=>raw=v};Capture.save(storage,[item]);assert.equal(JSON.parse(raw)[0].title,item.title);assert.equal(JSON.parse(raw)[0].notes,'keep this reason');
 assert.equal(SG.needsTitle({url:item.url,title:'How youtu.be redirects work'}),false);assert.equal(SG.needsTitle({url:item.url,title:'How to use www.youtube.com'}),false);assert.equal(SG.needsTitle({url:item.url,title:'youtu.be.evil.example'}),false);
});


test('WeChat article URLs retain identity and native preview saves original metadata with categories',async()=>{
 const url='http://mp.weixin.qq.com/s?__biz=MzA1AA%3D%3D&mid=123&idx=1&sn=0123456789abcdef0123456789abcdef';
 const item=SG.normalize({url,tags:['学习'],notes:'留着复习'});
 assert.equal(item.platform,'wechat');assert.equal(item.type,'article');assert.equal(new URL(item.url).searchParams.get('__biz'),'MzA1AA==');assert.equal(new URL(item.url).protocol,'https:');
 assert.equal(SG.detect('https://mp.weixin.qq.com.evil.test/s/abc'),'other');
 const page={window:null,SG,URL,setTimeout,clearTimeout,ShiguangPreviewNative:{postMessage(raw){const d=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:d.id,title:'公众号原文章标题',thumbnail:'https://mmbiz.qpic.cn/mmbiz_jpg/test/0?wx_fmt=jpeg'})}));}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/preview-client.js','utf8'),page);
 const meta=await page.ShiguangPreview.fetch(item);assert.equal(meta.title,'公众号原文章标题');assert.ok(page.ShiguangPreview.apply(item,meta));
 assert.equal(item.thumbnail,'https://mmbiz.qpic.cn/mmbiz_jpg/test/0?wx_fmt=jpeg');assert.deepEqual(item.tags,['学习']);assert.equal(item.notes,'留着复习');
});


test('immediate mobile category form preserves choices through link failure and retries without saving placeholders',async()=>{
 let raw='[]';const reports=[],elements={};
 const page={window:null,SG,ShiguangCapture:Capture,ShiguangCloud:{ready:Promise.resolve(),sync:async()=>({signedIn:true,pending:0})},ShiguangPreview:{needsTitle:()=>false,fetch:async()=>({})},ShiguangQuickResult:{postMessage:text=>reports.push(JSON.parse(text))},localStorage:{getItem:key=>key===Capture.KEY?raw:null,setItem:(k,v)=>raw=v},setTimeout:()=>{},document:{getElementById:id=>elements[id]??={}}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/share-form.js','utf8'),page);
 page.shiguangReceiveShare({pending:true,title:'Original article',platform:'wechat'});
 const draft=await page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_GET'});
 assert.equal(draft.pending,true);assert.equal(raw,'[]');assert.equal(reports.length,0);
 const failed=page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_SAVE',tags:'robots',reason:'study'});
 await Promise.resolve();assert.equal(reports[0].resolve,true);assert.equal(raw,'[]');
 page.shiguangResolveFailed('link unavailable');await assert.rejects(failed,/link unavailable/);
 assert.equal(raw,'[]');assert.equal(reports.some(x=>x.saved),false);
 const saved=page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_SAVE',tags:'robots',reason:'study'});
 await Promise.resolve();page.shiguangReceiveResolvedShare({url:'https://mp.weixin.qq.com/s/AbCdEfGh_123456',title:'Original article',thumbnail:'https://mmbiz.qpic.cn/test.jpg'});
 await saved;const item=JSON.parse(raw)[0];assert.equal(item.title,'Original article');assert.equal(item.notes,'study');assert.deepEqual(item.tags,['robots']);assert.equal(item.thumbnail,'https://mmbiz.qpic.cn/test.jpg');
 assert.equal(reports.filter(x=>x.saved).length,1);
});

for(const scenario of ['delete','edit','account'])test('background metadata respects '+scenario,async()=>{
 let raw='[]',owner='user-a',finish;const reports=[];
 const page={window:null,SG,ShiguangCapture:Capture,ShiguangCloud:{ready:Promise.resolve(),sync:async()=>({})},ShiguangPreview:{needsTitle:SG.needsTitle,fetch:()=>new Promise(resolve=>finish=resolve)},ShiguangQuickResult:{postMessage:text=>reports.push(JSON.parse(text))},localStorage:{getItem:key=>key===Capture.KEY?raw:owner,setItem:(key,value)=>{if(key===Capture.KEY)raw=value;}},setTimeout:()=>{},document:{getElementById:()=>({})}};page.window=page;
 vm.createContext(page);vm.runInContext(fs.readFileSync('dist/share-form.js','utf8'),page);
 page.shiguangReceiveShare({url:'https://v.douyin.com/abc/',title:'v.douyin.com'});
 await page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_GET'});
 const saving=page.ShiguangCaptureTransport.sendMessage({type:'SHIGUANG_CAPTURE_SAVE',tags:'study',reason:'original'});
 await Promise.resolve();assert.equal(reports[0].saved,true);
 if(scenario==='delete')raw='[]';
 if(scenario==='edit'){const rows=JSON.parse(raw);rows[0].title='My edited title';rows[0].notes='Edited reason';raw=JSON.stringify(rows);}
 if(scenario==='account'){owner='user-b';raw='[]';}
 finish({title:'Fetched title',thumbnail:'https://example.com/cover.jpg'});await saving;
 if(scenario==='edit'){assert.equal(JSON.parse(raw)[0].title,'My edited title');assert.equal(JSON.parse(raw)[0].notes,'Edited reason');}
 else assert.equal(raw,'[]');
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
  if(url.includes('oembed'))return Promise.resolve({ok:true,status:200,headers:new Map(),body:body(JSON.stringify({title:'The Essence of Linear Algebra',author_name:'3Blue1Brown',thumbnail_url:'https://i.ytimg.com/vi/fNk_zzaMoSs/hqdefault.jpg'}))});
  return Promise.resolve({ok:true,status:200,headers:new Map(),body:body('<html><head><title>Sign in to confirm you are not a bot</title></head></html>')});
 };
 for(const url of ['https://www.youtube.com/watch?v=fNk_zzaMoSs&vd_source=x','https://youtu.be/fNk_zzaMoSs','https://www.youtube.com/shorts/fNk_zzaMoSs']){
  const meta=await preview(url,stub);
  assert.equal(meta.title,'The Essence of Linear Algebra');
  assert.equal(meta.thumbnail,'https://i.ytimg.com/vi/fNk_zzaMoSs/hqdefault.jpg');
 }
});
