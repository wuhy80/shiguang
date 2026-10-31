const {test}=require('node:test'),assert=require('node:assert/strict'),SG=require('../dist/core.js');
test('reject dangerous URLs and spoofed platform domains',()=>{for(const url of ['javascript:alert(1)','data:text/html,hi','file:///c:/test','not a url'])assert.equal(SG.normalize({url}),null);assert.equal(SG.detect('https://zhihu.com.attacker.com'),'other');assert.equal(SG.detect('https://www.bilibili.com/video/BV123'),'bilibili')});
test('canonical URLs deduplicate YouTube variants and strip tracking',()=>{const r=SG.merge([],[{url:'https://youtu.be/abc?si=1',title:'a'},{url:'https://www.youtube.com/watch?v=abc&list=xyz',title:'b'}]);assert.equal(r.added,1);assert.equal(r.duplicates,1)});
test('CSV handles quotes, newlines, BOM, Chinese columns and Takeout',()=>{const a=SG.parseFile('\uFEFF标题,链接,笔记\r\n"你好,世界",https://example.com,"第一行\n第二行"','test.csv');assert.equal(a[0].title,'你好,世界');assert.equal(a[0].notes,'第一行\n第二行');assert.equal(SG.parseFile('Video Id,Time Added\nabc,2026','yt.csv')[0].platform,'youtube');assert.throws(()=>SG.csvRows('"bad'),/引号/)});
test('JSON restores status and merge preserves current notes',()=>{const a=SG.normalize({url:'https://example.com',notes:'keep',read:true,starred:true});const b=SG.parseFile(JSON.stringify({items:[a,{url:'javascript:bad'}]}),'b.json');assert.equal(b.length,1);assert.equal(b[0].read,true);const r=SG.merge([a],[{url:a.url,notes:'overwrite'}]);assert.equal(r.items[0].notes,'keep');assert.equal(r.duplicates,1)});
test('search combines notes and tags with platform and read filters',()=>{const arr=[SG.normalize({url:'https://www.bilibili.com/video/BV1',title:'函数',tags:['Python'],notes:'递归',read:false}),SG.normalize({url:'https://example.com',title:'Python'})];assert.equal(SG.filter(arr,{q:'python 递归',platform:'bilibili',view:'unread'}).length,1);assert.equal(SG.filter(arr,{view:'read'}).length,0)});
test('duplicate IDs are repaired, invalid dates normalized and tags bounded',()=>{const a=SG.normalize({url:'https://example.com/1',id:'same'});const r=SG.merge([a],[{url:'https://example.com/2',id:'same',date:'invalid',tags:[null,1,' a ','a']}]);assert.notEqual(r.items[0].id,r.items[1].id);assert.deepEqual(r.items[0].tags,['a']);assert.ok(Number.isFinite(Date.parse(r.items[0].createdAt)))});
test('Xiaohongshu cn short links and old other-site records regain their platform without losing tokens',()=>{
 for(const file of ['../dist/core.js','../collector/core.js']){
  const core=require(file),url='https://xhslink.cn/o/abc?xsec_token=a%2Bb';
  assert.equal(core.detect(url),'xiaohongshu');
  const item=core.normalize({url,platform:'other',title:'笔记',tags:['机器人'],notes:'收藏原因'});
  assert.equal(item.platform,'xiaohongshu');assert.equal(item.url,url);assert.deepEqual(item.tags,['机器人']);assert.equal(item.notes,'收藏原因');
  assert.equal(core.detect('https://xhslink.cn.evil.test/o/abc'),'other');
 }
});
test('known link domains correct previously wrong platform while retaining collection metadata',()=>{
 for(const file of ['../dist/core.js','../collector/core.js']){
  const core=require(file),url='https://xhslink.cn/o/abc?xsec_token=a%2Bb';
  const fixed=core.normalize({url,platform:'bilibili',tags:['机器人'],notes:'保留原因',read:true,starred:true});
  assert.equal(fixed.platform,'xiaohongshu');assert.equal(fixed.url,url);assert.deepEqual(fixed.tags,['机器人']);assert.equal(fixed.notes,'保留原因');assert.equal(fixed.read,true);assert.equal(fixed.starred,true);
  assert.equal(core.normalize({url:'https://b23.tv/abc',platform:'xiaohongshu'}).platform,'bilibili');
 }
});

test('Douyin collection modal links canonicalize to the public video page and dedupe',()=>{
 const modal='https://www.douyin.com/user/self?from_tab_name=main&modal_id=7617464281105321235&showSubTab=compilation&showTab=favorite_collection';
 const item=SG.normalize({url:modal});
 assert.equal(item.url,'https://www.douyin.com/video/7617464281105321235');
 assert.equal(item.platform,'douyin');assert.equal(item.type,'video');
 assert.equal(SG.normalize({url:'https://www.iesdouyin.com/share/video/7617464281105321235'}).url,'https://www.douyin.com/video/7617464281105321235');
 assert.equal(SG.normalize({url:'https://m.douyin.com/video/7617464281105321235'}).url,'https://www.douyin.com/video/7617464281105321235');
 const r=SG.merge([],[{url:modal,title:'x'},{url:'https://www.douyin.com/video/7617464281105321235',title:'y'}]);
 assert.equal(r.added,1);assert.equal(r.duplicates,1);
});
