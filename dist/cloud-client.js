(function(root){
 'use strict';
 const config=root.ShiguangCloudConfig,KEY='shiguang.library.v1',OWNER='shiguang.cloud.owner';
 const client=ShiguangSupabase.createClient(config.url,config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(12000)})}});
 const model=root.ShiguangSyncModel;
 let user=null,active=null,debounce;
 const readItems=()=>{const raw=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(raw))throw Error('本机知识库格式异常，请先备份');return raw;};
 const stateKey=uid=>'shiguang.cloud.state.'+uid;
 const getState=uid=>JSON.parse(localStorage.getItem(stateKey(uid))||'{"last":{},"pending":{}}');
 const setState=(uid,state)=>localStorage.setItem(stateKey(uid),JSON.stringify(state));
 const status=(text)=>{api.message=text;root.dispatchEvent(new CustomEvent('shiguang-cloud-status',{detail:text}));};
 function bind(next){
  if(!next)return;
  const previous=localStorage.getItem(OWNER);
  if(previous!==next.id){
   const guest=previous?[]:readItems();
   if(previous)localStorage.setItem('shiguang.cloud.archive.'+previous,localStorage.getItem(KEY)||'[]');
   const archived=JSON.parse(localStorage.getItem('shiguang.cloud.archive.'+next.id)||'[]');
   localStorage.setItem(KEY,JSON.stringify(SG.merge(archived,guest).items));
   root.dispatchEvent(new Event('shiguang-refresh'));
  }
  localStorage.setItem(OWNER,next.id);user=next;api.user=user;
 }
 function observe(uid){if(localStorage.getItem(OWNER)!==uid)throw Error('账号已切换，请重新同步');const state=model.observe(getState(uid),readItems(),()=>crypto.randomUUID());setState(uid,state);return state;}
 async function run(){
  await api.ready;
  const {data,error}=await client.auth.getSession();if(error)throw error;
  if(!data.session){status('登录后自动同步');return {signedIn:false};}
  bind(data.session.user);const uid=user.id;
  status('正在同步…');
  const initial=observe(uid),snapshot={...initial.pending};
  for(const [url,operation] of Object.entries(snapshot)){
   if(operation.kind==='new'){
    const {error}=await client.rpc('capture_link',{item:operation.payload});if(error)throw error;
   }else{
    const {error}=await client.from('library_entries').upsert({user_id:uid,url,payload:operation.payload,deleted:operation.kind==='delete'},{onConflict:'user_id,url'});if(error)throw error;
   }
   // A local edit arriving while a request is in flight must remain queued.
   let latest=observe(uid);latest=model.acknowledge(latest,{[url]:operation});setState(uid,latest);
  }
  const rows=[];
  for(let start=0;;start+=500){
   const {data,error}=await client.from('library_entries').select('url,payload,deleted').eq('user_id',uid).order('url').range(start,start+499);
   if(error)throw error;rows.push(...data);if(data.length<500)break;
  }
  const current=observe(uid),merged=model.pull(current,readItems(),rows);
  localStorage.setItem(KEY,JSON.stringify(merged.items));setState(uid,merged.state);
  root.dispatchEvent(new Event('shiguang-refresh'));
  const count=Object.keys(merged.state.pending).length;
  status(count?'有新收藏等待同步':'已同步 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));
  if(count)schedule();return {signedIn:true,pending:count};
 }
 async function sync(){
  if(active)return active;
  const work=()=>run();
  active=(navigator.locks?navigator.locks.request('shiguang-cloud-sync',work):work()).catch(error=>{status('暂未同步，内容保存在本机');throw error;}).finally(()=>{active=null;});return active;
 }
 function schedule(){clearTimeout(debounce);debounce=setTimeout(()=>sync().catch(()=>{}),700);}
 const api={client,user,message:'登录后自动同步',sync,schedule,
  async requestCode(email){const {error}=await client.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:'https://wuhy80.github.io/shiguang/'}});if(error)throw error;},
  async verifyCode(email,token){const {data,error}=await client.auth.verifyOtp(ShiguangAuthInput.parse(token,config.url,email));if(error)throw error;bind(data.user);await sync();},
  async signOut(){
   // Flush before switching identities; on failure keep the session and all pending work.
   await sync();
   const uid=user?.id;
   if(uid&&Object.keys(observe(uid).pending).length)throw Error('还有内容待同步，请联网同步完成后再退出');
   if(uid)localStorage.setItem('shiguang.cloud.archive.'+uid,localStorage.getItem(KEY)||'[]');
   const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;
   user=null;api.user=null;localStorage.removeItem(OWNER);localStorage.setItem(KEY,'[]');root.dispatchEvent(new Event('shiguang-refresh'));status('已退出，云端收藏仍保留');
  }
 };
 root.ShiguangCloud=api;
 api.ready=client.auth.getSession().then(({data,error})=>{if(error)throw error;if(data.session)bind(data.session.user);status(user?'已登录，正在准备同步':'登录后自动同步');}).catch(()=>status('暂未连接云端，收藏保存在本机'));
 client.auth.onAuthStateChange((event,session)=>{if(session){user=session.user;api.user=user;}if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED')schedule();});
 root.addEventListener('online',schedule);root.addEventListener('shiguang-local-change',schedule);
 root.addEventListener('storage',event=>{if(event.key===KEY)schedule();});
 root.addEventListener('focus',schedule);
 if(!location.pathname.endsWith('quick-share.html')){api.ready.then(schedule);setInterval(()=>{if(document.visibilityState==='visible')schedule();},30000);}
})(window);
