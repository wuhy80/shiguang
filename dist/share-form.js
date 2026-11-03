(function(){
 'use strict';
 let draft=null,resolveDraft,saving=false,persisted=false,owner=null,metadata=Promise.resolve(),resolveLink,rejectLink;
 const ready=new Promise(resolve=>resolveDraft=resolve);
 const report=data=>window.ShiguangQuickResult?.postMessage(JSON.stringify(data));
 window.shiguangReceiveShare=item=>{
  if(item?.pending){if(draft)return;draft={pending:true,title:item.title||'选择分类后保存',platform:item.platform,url:''};const source=document.getElementById('platform');if(source)source.textContent='来源：'+(item.platform||'原应用');resolveDraft();return;}
  if(draft)return;draft=SG.normalize(item);if(draft&&!draft.thumbnail)draft.thumbnail=SG.thumbnailFor(draft);resolveDraft();
  if(draft){const source=document.getElementById('platform');if(source)source.textContent='来源：'+(SG.platforms[draft.platform]?.name||'其他网站');}
  function applyMetadata(meta){
   if(persisted){
    // Re-read the current library: never resurrect a deleted item or overwrite edits.
    if(localStorage.getItem('shiguang.cloud.owner')!==owner)return;
    const items=JSON.parse(localStorage.getItem(ShiguangCapture.KEY)||'[]');
    const current=items.find(item=>SG.canonical(item.url)===SG.canonical(draft.url));
    if(!current)return;let changed=false;
    if(!current.thumbnail&&SG.safeImage(meta.thumbnail)){current.thumbnail=SG.safeImage(meta.thumbnail);changed=true;}
    if(SG.needsTitle(current)&&meta.title&&!SG.needsTitle({...current,title:meta.title})){current.title=String(meta.title).slice(0,500);changed=true;}
    if(changed)localStorage.setItem(ShiguangCapture.KEY,JSON.stringify(items));
    return;
   }if(meta.thumbnail)draft.thumbnail=SG.safeImage(meta.thumbnail);if(meta.title&&ShiguangPreview.needsTitle(draft)){draft.title=String(meta.title).slice(0,500);document.getElementById('title').textContent=draft.title;}if(meta.requiresLogin)document.getElementById('status').textContent='小红书要求网页登录。可先保存原链接，再到拾光「我 → 登录小红书补全信息」，登录后补全封面。';}
  if(draft)metadata=Promise.race([ShiguangPreview.fetch(draft,applyMetadata),new Promise(resolve=>setTimeout(()=>resolve({}),12500))]).then(applyMetadata).catch(()=>{});
 };
 window.shiguangReceiveResolvedShare=item=>{
  if(!draft?.pending||!resolveLink)return;
  const valid=SG.normalize(item);if(!valid){window.shiguangResolveFailed('未取得有效原链接，本次未保存');return;}
  draft=null;window.shiguangReceiveShare(item);
  document.getElementById('title').textContent=draft.title;document.getElementById('url').textContent=draft.url;
  const done=resolveLink;resolveLink=null;rejectLink=null;done();
 };
 window.shiguangResolveFailed=message=>{if(rejectLink){const fail=rejectLink;resolveLink=null;rejectLink=null;fail(Error(message||'未取得原链接，本次未保存'));}};
 window.ShiguangCloseCapture=()=>report({cancel:true});
 window.ShiguangCaptureTransport={async sendMessage(message){
  await ready;if(!draft)throw Error('分享链接无效，请重新分享');
  if(message.type==='SHIGUANG_CAPTURE_GET'){
   // Use the same library origin and account as the main Android activity.
   await ShiguangCloud.ready;owner=localStorage.getItem("shiguang.cloud.owner");
   const entries=JSON.parse(localStorage.getItem(ShiguangCapture.KEY)||'[]');
   let saved=[];try{const key='shiguang.categories.v1.'+(owner||'guest');const value=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(value))saved=value.filter(x=>typeof x==='string');}catch{}return {...draft,tags:[...new Set([...saved,...entries.flatMap(item=>item.tags||[])])]};
  }
  if(message.type==='SHIGUANG_CAPTURE_SAVE'){
   if(saving)throw Error('正在保存，请稍候');if(localStorage.getItem('shiguang.cloud.owner')!==owner)throw Error('账号已切换，请重新分享');saving=true;
   try{
    if(draft.pending)await new Promise((resolve,reject)=>{resolveLink=resolve;rejectLink=reject;report({resolve:true});});
    if(localStorage.getItem('shiguang.cloud.owner')!==owner)throw Error('账号已切换，请重新分享');
    const result=ShiguangCapture.save(localStorage,[{...draft,tags:message.tags,notes:message.reason||''}]);
    persisted=true;
    report({saved:true});
    // Keep the editor alive while metadata and synchronization finish.
    // The durable library itself is the retry source on the next app launch.
    await metadata;
    if(localStorage.getItem('shiguang.cloud.owner')!==owner){report({done:true,cloud:false});return {ok:true};}
    let cloud=false;try{const result=await Promise.race([ShiguangCloud.sync(),new Promise(resolve=>setTimeout(()=>resolve({}),5000))]);cloud=!!result.signedIn&&result.pending===0;}catch{}
    report({done:true,cloud,duplicate:result.duplicates>0});return {ok:true,duplicate:result.duplicates>0};
   }catch(error){saving=false;throw error;}
  }
  throw Error('无法识别的收藏操作');
 }};
})();
