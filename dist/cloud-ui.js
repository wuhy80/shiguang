(function(){
 'use strict';
 const cloud=window.ShiguangCloud,button=document.getElementById('cloud-account');
 const withTimeout=work=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('连接超时，请检查网络后重试')),15000);Promise.resolve(work).then(resolve,reject).finally(()=>clearTimeout(timer));});
 function update(){button.textContent=cloud.user?'☁ '+cloud.message:'☁ 登录同步';}
 window.addEventListener('shiguang-cloud-status',update);cloud.ready.then(update);
 button.onclick=()=>{
  if(cloud.user){
   openModal('你的收藏，随身可见。',`<p class="help">已登录：${esc(cloud.user.email||'')}<br>${esc(cloud.message)}<br>手机 App、电脑扩展和网站使用同一个邮箱登录，即可同步收藏。离线时先保存在本机，联网后补传。</p><div class="data-actions"><button id="cloud-now">立即同步</button><button id="cloud-out">退出此设备</button></div><p id="cloud-feedback" class="help" role="status"></p>`);
   document.getElementById('cloud-now').onclick=async()=>{const feedback=document.getElementById('cloud-feedback');feedback.textContent='正在同步…';try{await withTimeout(cloud.sync());feedback.textContent=cloud.message;}catch{feedback.textContent='暂时无法同步，收藏仍保存在本机，请联网后重试。';}};
   document.getElementById('cloud-out').onclick=async()=>{try{await withTimeout(cloud.signOut());closeModal();}catch(e){document.getElementById('cloud-feedback').textContent=e.message;}};return;
  }
  openModal('登录，让收藏自动相遇。',`<p class="help">登录后，本机真实收藏会上传至你的私有知识库，换设备打开同一浏览器外任意设备登录即可同步。示例不会上传。</p><button id="cloud-github" class="primary">用 GitHub 登录</button><p id="cloud-feedback" class="help" role="status"></p>`);
  const feedback=document.getElementById('cloud-feedback');
  document.getElementById('cloud-github').onclick=async event=>{event.target.disabled=true;feedback.textContent='正在跳转到 GitHub 授权…';try{await withTimeout(cloud.signInWithGitHub());}catch(e){feedback.textContent='跳转失败：'+e.message;event.target.disabled=false;}};
 };
})();
