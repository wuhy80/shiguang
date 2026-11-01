'use strict';
// 网页截图图库：没有封面（og:image）的页面，收藏时截取当前可见区域，
// 上传到用户自己的 GitHub 仓库，经 GitHub Pages 提供免费的 https 图床。
// 配置存放于 chrome.storage.local['shiguang.gallery']：
//   repo  'owner/repo'（该仓库需开启 Pages）
//   dir   仓库内目录，默认 'shiguang-covers'
//   token fine-grained PAT，仅需该仓库 Contents 读写权限
//   branch 可选，默认 main；page 可选，自定义 Pages 前缀（少见）
(function(){
 const STORE_KEY='shiguang.gallery';
 const DEFAULTS={repo:'',dir:'shiguang-covers',branch:'main',token:'',page:''};
 const cleanDir=value=>String(value||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'').replace(/[^-\w./]/g,'').slice(0,80);
 async function readConfig(){
  const stored=(await chrome.storage.local.get(STORE_KEY))[STORE_KEY]||{};
  return {...DEFAULTS,...stored,dir:cleanDir(stored.dir||DEFAULTS.dir),page:String(stored.page||'').replace(/\/+$/,'')};
 }
 // 配置完整（仓库 + token 都填了）才启用截图封面
 async function activeConfig(){
  const config=await readConfig();
  return /^[\w.-]+\/[\w.-]+$/.test(config.repo)&&config.token.trim()?config:null;
 }
 function toBase64(bytes){
  let binary='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));
  return btoa(binary);
 }
 // 截取当前可见页面并压缩到 960px 宽的 JPEG。必须在向页面注入任何提示前调用。
 async function captureShot(tab){
  try{
   if(!tab||!tab.windowId)return null;
   const dataUrl=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'jpeg',quality:82});
   const blob=await (await fetch(dataUrl)).blob();
   if(typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined')return blob;
   const bitmap=await createImageBitmap(blob);
   const scale=Math.min(1,960/bitmap.width);
   const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
   canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   bitmap.close();
   return await canvas.convertToBlob({type:'image/jpeg',quality:0.72});
  }catch{return null;}
 }
 async function upload(blob,config){
  const name='sg-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)+'.jpg';
  const path=(config.dir?config.dir+'/':'')+name;
  const [owner,repoName]=config.repo.split('/');
  const response=await fetch('https://api.github.com/repos/'+config.repo+'/contents/'+path,{
   method:'PUT',
   headers:{'Authorization':'Bearer '+config.token.trim(),'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
   body:JSON.stringify({message:'拾光收藏封面 '+name,content:toBase64(new Uint8Array(await blob.arrayBuffer())),branch:config.branch||undefined})
  });
  if(!response.ok){
   const reason=response.status===401?'Token 无效或已过期':response.status===404?'仓库不存在或 Token 没有该仓库权限':response.status===422?'上传被拒绝（检查分支名）':'HTTP '+response.status;
   throw Error('GitHub 图库：'+reason);
  }
  if(config.page)return config.page+'/'+path;
  // owner/owner.github.io 仓库的 Pages 根就是 owner.github.io，其余仓库挂在 /repo 子路径
  const base=repoName.endsWith('.github.io')?'https://'+owner+'.github.io':'https://'+owner+'.github.io/'+repoName;
  return base+'/'+path;
 }
 globalThis.ShiguangGallery={readConfig,activeConfig,captureShot,upload,cleanDir,STORE_KEY};
})();
