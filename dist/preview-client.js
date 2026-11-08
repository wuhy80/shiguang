(function(root){
 'use strict';
 const domains=['mp.weixin.qq.com','bilibili.com','b23.tv','youtube.com','youtu.be','linux.do','zhihu.com','zhihu.link','xiaohongshu.com','xhslink.com','xhslink.cn','douyin.com','iesdouyin.com','github.com'];
 const needsTitle=SG.needsTitle;
 function apply(item,meta){let changed=false;if(!item.thumbnail&&SG.safeImage(meta.thumbnail)){item.thumbnail=SG.safeImage(meta.thumbnail);changed=true;}if(needsTitle(item)&&meta.title&&!needsTitle({...item,title:meta.title})){item.title=String(meta.title).slice(0,500);changed=true;}if(!item.episodes&&Array.isArray(meta.episodes)&&meta.episodes.length){const episodes=meta.episodes.map(e=>SG.normalize(e)).filter(Boolean).map(({url,title,thumbnail})=>({url,title,thumbnail}));if(episodes.length){item.episodes=episodes;changed=true;}}return changed;}
 function supported(url){try{const u=new URL(url);return u.protocol==='https:'&&domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}}
 async function fetchPreview(item,onProgress){
  const direct=SG.thumbnailFor(item);if(direct&&!needsTitle(item))return {thumbnail:direct};
  let partial=direct?{thumbnail:direct}:{};
  if(SG.detect(item.url)==='wechat')return partial;
  const cloud=root.ShiguangCloud;if(!cloud||!supported(item.url))return partial;
  try{await cloud.ready;const {data}=await cloud.client.auth.getSession();if(!data.session)return partial;
  const response=await fetch(root.ShiguangCloudConfig.url+'/functions/v1/link-preview',{method:'POST',headers:{'Content-Type':'application/json',apikey:root.ShiguangCloudConfig.key,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({url:item.url}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)return partial;const result=await response.json();return {...partial,thumbnail:partial.thumbnail||SG.safeImage(result.thumbnail),title:partial.title||String(result.title||'').slice(0,500)};}catch{return partial;}
 }
 root.ShiguangPreview={fetch:fetchPreview,supported,needsTitle,apply};
})(window);
