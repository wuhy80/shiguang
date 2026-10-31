const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const SG=require('../dist/core.js'),Capture=require('../dist/capture-store.js');
const path=require('node:path');
function worker(){
 const events={},db={},listeners=[],windows=[],api={commands:{onCommand:{addListener:fn=>events.command=fn}},contextMenus:{onClicked:{addListener:fn=>events.menu=fn}},windows:{create:async options=>windows.push(options)},alarms:{create(){},onAlarm:{addListener(){}}},runtime:{id:'test-extension',getURL:name=>'chrome-extension://test-extension/'+name,onMessage:{addListener:fn=>listeners.push(fn)},onInstalled:{addListener(){}},onStartup:{addListener(){}}},action:{onClicked:{addListener:fn=>events.click=fn},setBadgeBackgroundColor:async()=>{},setBadgeText:async()=>{},setTitle:async()=>{}},tabs:{query:async query=>query.active?[{id:1}]:[]},storage:{local:{get:async key=>structuredClone({[key]:db[key]}),set:async values=>Object.assign(db,structuredClone(values))}},scripting:{executeScript:async options=>options.args?[]:[{result:String(options.func).includes('/collection/')?{url:'https://www.douyin.com/collection/7598762810813828404',title:'B树详解合集 - 抖音',thumbnail:'https://p3-sign.douyinpic.com/c.webp',selection:''}:{url:'https://www.bilibili.com/video/BV123?vd_source=a',title:'学习视频',selection:'选中的内容'}}]}};
 const ctx={URL,chrome:api,importScripts(){},SG,console,crypto:require('node:crypto').webcrypto,pushCloud:async()=>({signedIn:false})};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../collector/background.js'),'utf8'),ctx);
 const sender={id:'test-extension',tab:{url:'https://wuhy80.github.io/shiguang/'}};
 const send=(data,from)=>new Promise(resolve=>{let handled=false;for(const listener of listeners)if(listener(data,from,resolve)===true)handled=true;if(!handled)resolve(undefined);});
 const message=data=>send(data,sender);
 const editor=data=>send(data,{id:'test-extension',url:api.runtime.getURL('capture.html')+'?draft='+data.id});
 const capture=async(fields={})=>{await events.click({id:1});const id=Object.keys(db.captureDrafts).at(-1);return editor({type:'SHIGUANG_CAPTURE_SAVE',id,...fields});};
 return {events,db,message,editor,capture,send,windows};
}
test('capture requires confirmation, saves optional categories and reason, and duplicate clicks preserve notes',async()=>{
 const w=worker();await w.events.click({id:1});assert.equal((await w.message({type:'SHIGUANG_PENDING'})).items.length,0);assert.equal(w.windows[0].type,'popup');
 const draft=Object.keys(w.db.captureDrafts)[0];assert.equal((await w.editor({type:'SHIGUANG_CAPTURE_SAVE',id:draft,tags:'机器人，编程',reason:'学习控制算法'})).ok,true);
 await w.capture({reason:'不能覆盖原有原因'});
 const response=await w.message({type:'SHIGUANG_PENDING'});assert.equal(response.items.length,1);assert.equal(response.items[0].notes,'学习控制算法\n\n摘录：选中的内容');assert.deepEqual([...response.items[0].tags],['机器人','编程']);
 await w.message({type:'SHIGUANG_ACK',ids:['unknown']});assert.equal((await w.message({type:'SHIGUANG_PENDING'})).items.length,1);
 await w.message({type:'SHIGUANG_ACK',ids:response.items.map(x=>x.id)});assert.equal((await w.message({type:'SHIGUANG_PENDING'})).items.length,0);
});
test('opening library drains to site storage; full storage retains queued capture for retry',async()=>{
 const w=worker();await w.capture();let raw=null,full=true;const uiEvents=[];
 const localStorage={getItem:()=>raw,setItem:(key,value)=>{if(full)throw Error('quota');raw=value}};
 const page={chrome:{runtime:{sendMessage:w.message,onMessage:{addListener(){}}}},localStorage,ShiguangCapture:Capture,window:{dispatchEvent:event=>uiEvents.push(event),addEventListener(){}},StorageEvent:function(type,props){Object.assign(this,props)},console:{warn(){}},document:{createElement:()=>({style:{},remove(){}}),body:{append(){}}},setTimeout(){},setInterval(){},clearInterval(){}};
 const source=fs.readFileSync(path.join(__dirname,'../collector/library-bridge.js'),'utf8');
 vm.createContext(page);vm.runInContext(source,page);
 // Await the actual drain instead of sleeping; it shares a single in-flight guard.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await w.message({type:'SHIGUANG_PENDING'})).items.length,1);assert.equal(raw,null);
 full=false;await vm.runInContext('drain()',page);
 assert.equal(JSON.parse(raw).length,1);assert.equal((await w.message({type:'SHIGUANG_PENDING'})).items.length,0);assert.equal(uiEvents.length,1);
});

test('shortcut and context menu open capture; account switching prevents saving a draft into a different account',async()=>{
 const w=worker();await w.events.command('save-current-page');await w.events.menu({menuItemId:'shiguang-save',linkUrl:'https://example.com/lesson'},{id:1});
 assert.equal(w.windows.length,2);const id=Object.keys(w.db.captureDrafts).at(-1);assert.equal((await w.editor({type:'SHIGUANG_CAPTURE_GET',id})).url,'https://example.com/lesson');
 w.db['shiguang.extension.owner']='new-owner';assert.match((await w.editor({type:'SHIGUANG_CAPTURE_SAVE',id})).error,/账号已切换/);assert.equal((await w.message({type:'SHIGUANG_PENDING'})).items.length,0);
 assert.equal(await w.message({type:'SHIGUANG_CAPTURE_SAVE',id}),undefined);
});

test('space plus S ignores editable fields, repeats and resets on blur',async()=>{
 const handlers={},sent=[];class Element{matches(){return this.edit;}get isContentEditable(){return false;}}
 const ctx={Element,location:{href:'https://example.com/current-topic'},document:{addEventListener:(name,fn)=>handlers[name]=fn,title:'网页标题'},window:{addEventListener:(name,fn)=>handlers[name]=fn},getSelection:()=>({toString:()=>''}),chrome:{runtime:{sendMessage:async message=>{sent.push(message);}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../collector/shortcut.js'),'utf8'),ctx);
 const key=(code,extra={})=>({code,composedPath:()=>[],preventDefault(){},stopPropagation(){},...extra});
 const input=new Element();input.edit=true;
 handlers.keydown(key('Space',{composedPath:()=>[input]}));handlers.keydown(key('KeyS'));assert.equal(sent.length,0);
 handlers.keydown(key('Space'));handlers.keydown(key('KeyS'));handlers.keydown(key('KeyS',{repeat:true}));assert.equal(sent.length,1);
 handlers.blur();handlers.keydown(key('KeyS'));assert.equal(sent.length,1);
 handlers.keydown(key('Space'));handlers.keyup(key('Space'));handlers.keydown(key('KeyS'));assert.equal(sent.length,1);
});

test('page shortcut uses the content sender URL without requiring sensitive tab metadata or activeTab',async()=>{
 const w=worker();const result=await w.send({type:'SHIGUANG_SHORTCUT',title:'公开教程',selection:''},{id:'test-extension',url:'https://example.com/tutorial',tab:{id:3}});
 assert.equal(result.ok,true);const id=Object.keys(w.db.captureDrafts)[0];assert.equal(w.db.captureDrafts[id].raw.url,'https://example.com/tutorial');
 assert.equal((await w.editor({type:'SHIGUANG_CAPTURE_SAVE',id,tags:'',reason:''})).ok,true);
 const items=(await w.message({type:'SHIGUANG_PENDING'})).items;assert.equal(items[0].notes,'');assert.equal(items[0].tags.length,0);
});

test('SPA shortcuts capture the current same-origin topic URL and reject a different origin',async()=>{
 const w=worker(),sender={id:'test-extension',url:'https://linux.do/',tab:{id:3}};
 await w.send({type:'SHIGUANG_SHORTCUT',url:'https://linux.do/t/topic/123',title:'话题'},sender);
 assert.equal(Object.values(w.db.captureDrafts)[0].raw.url,'https://linux.do/t/topic/123');
 await w.send({type:'SHIGUANG_SHORTCUT',url:'https://evil.example/',title:'测试'},sender);
 assert.equal(Object.values(w.db.captureDrafts).at(-1).raw.url,'https://linux.do/');
});


test('category suggestions include library tags and survive queue draining without leaking account tags',async()=>{
 const w=worker();await w.message({type:'SHIGUANG_CATEGORIES',tags:['机器人','操作演示']});
 await w.events.click({id:1});let id=Object.keys(w.db.captureDrafts).at(-1);
 assert.deepEqual([...(await w.editor({type:'SHIGUANG_CAPTURE_GET',id})).tags],['机器人','操作演示']);
 await w.editor({type:'SHIGUANG_CAPTURE_SAVE',id,tags:'新分类'});
 const entries=(await w.message({type:'SHIGUANG_PENDING'})).items;
 await w.message({type:'SHIGUANG_ACK',ids:entries.map(x=>x.id)});
 await w.events.click({id:1});id=Object.keys(w.db.captureDrafts).at(-1);
 assert.ok((await w.editor({type:'SHIGUANG_CAPTURE_GET',id})).tags.includes('新分类'));
 w.db['shiguang.extension.owner']='another-user';await w.events.click({id:1});id=Object.keys(w.db.captureDrafts).at(-1);
 assert.equal((await w.editor({type:'SHIGUANG_CAPTURE_GET',id})).tags.length,0);
 assert.equal(await w.send({type:'SHIGUANG_CATEGORIES',tags:['非法']},{id:'test-extension',tab:{url:'https://example.com/'}}),undefined);
});


test('extension reload stops old bridge timers, shows one refresh notice and never acknowledges unsaved captures',async()=>{
 for(const asyncFailure of [false,true]){
 let sends=0,acks=0,cleared=0,warnings=0;const notices=[],removed=[];
 const page={chrome:{runtime:{sendMessage:message=>{sends++;if(message.type==='SHIGUANG_ACK')acks++;const error=Error('Extension context invalidated.');if(asyncFailure)return Promise.reject(error);throw error;},onMessage:{addListener(){}}}},localStorage:{getItem:()=>null},ShiguangCapture:Capture,window:{addEventListener(){},removeEventListener:name=>removed.push(name)},console:{warn(){warnings++;}},document:{createElement:()=>({style:{},setAttribute(){}}),body:{append:note=>notices.push(note)}},setInterval:()=>42,clearInterval:id=>{assert.equal(id,42);cleared++;}};
 vm.createContext(page);vm.runInContext(fs.readFileSync(path.join(__dirname,'../collector/library-bridge.js'),'utf8'),page);
 await new Promise(resolve=>setImmediate(resolve));await vm.runInContext('drain()',page);await vm.runInContext('drain()',page);
 assert.equal(sends,1);assert.equal(acks,0);assert.equal(cleared,1);assert.equal(warnings,0);assert.equal(notices.length,1);assert.match(notices[0].textContent,/刷新/);assert.deepEqual(removed,['storage','focus']);
 }
});

test('stale shortcut handles synchronous invalidation and stops messaging',()=>{
 const handlers={};let sends=0;
 const page={location:{href:"https://example.com/tutorial"},Element:class{},document:{addEventListener:(key,fn)=>handlers[key]=fn,title:'教程'},window:{addEventListener(){}},getSelection:()=>({toString:()=>''}),chrome:{runtime:{sendMessage(){sends++;throw Error('Extension context invalidated.');}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../collector/shortcut.js'),'utf8'),page);
 const event=code=>({code,composedPath:()=>[],preventDefault(){},stopPropagation(){}});
 for(let i=0;i<2;i++){handlers.keydown(event('Space'));assert.doesNotThrow(()=>handlers.keydown(event('KeyS')));handlers.keyup(event('Space'));}
 assert.equal(sends,1);
});

test('douyin collection menu drafts the canonical collection page',async()=>{
 const w=worker();await w.events.menu({menuItemId:'shiguang-douyin-collection'},{id:1});
 assert.equal(w.windows.length,1);
 const id=Object.keys(w.db.captureDrafts).at(-1);
 assert.equal(w.db.captureDrafts[id].raw.url,'https://www.douyin.com/collection/7598762810813828404');
 await w.editor({type:'SHIGUANG_CAPTURE_SAVE',id,tags:'合集',reason:''});
 const items=(await w.message({type:'SHIGUANG_PENDING'})).items;
 assert.equal(items.length,1);assert.equal(items[0].platform,'douyin');assert.equal(items[0].type,'video');
});
