'use strict';
let extensionClient,cloudWork=Promise.resolve();
function getCloud(){
 if(!extensionClient){
  const storage={getItem:async key=>(await chrome.storage.local.get(key))[key]??null,setItem:async(key,value)=>{await chrome.storage.local.set({[key]:value});},removeItem:async key=>{await chrome.storage.local.remove(key);}};
  extensionClient=ShiguangSupabase.createClient(ShiguangCloudConfig.url,ShiguangCloudConfig.key,{auth:{storage,storageKey:'shiguang.extension.auth',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(10000)})}});
 }
 return extensionClient;
}
function pushCloud(){
 const next=cloudWork.then(async()=>{
  const client=getCloud(),{data,error}=await client.auth.getSession();if(error)throw error;
  if(!data.session)return {signedIn:false};
  const queue=await locked(pending);
  const owner=data.session.user.id;
  for(const item of queue){
   if(item.cloudOwner&&item.cloudOwner!==owner)continue;
   if(item.uploadedFor===owner)continue;
   const payload=SG.normalize(item);
   const {error}=await client.rpc('capture_link',{item:payload});if(error)throw error;
   await locked(async()=>{const current=await pending();const match=current.find(x=>x.id===item.id);if(match){match.uploadedFor=owner;match.cloudOwner=owner;await chrome.storage.local.set({[QUEUE]:current});}});
  }
  return {signedIn:true,email:data.session.user.email};
 });cloudWork=next.catch(()=>{});return next;
}
async function cloudMessage(message){
 const client=getCloud();
 if(message.type==='SHIGUANG_CLOUD_STATUS'){const {data,error}=await client.auth.getSession();if(error)throw error;return{email:data.session?.user.email||null};}
 if(message.type==='SHIGUANG_CLOUD_SEND'){
  const {error}=await client.auth.signInWithOtp({email:message.email,options:{shouldCreateUser:true,emailRedirectTo:'https://wuhy80.github.io/shiguang/'}});if(error)throw error;return{ok:true};
 }
 if(message.type==='SHIGUANG_CLOUD_VERIFY'){
  const {data,error}=await client.auth.verifyOtp(ShiguangAuthInput.parse(message.token,ShiguangCloudConfig.url,message.email));if(error)throw error;
  await chrome.storage.local.set({'shiguang.extension.owner':data.user.id});
  await locked(async()=>{const queue=await pending();for(const item of queue)if(!item.cloudOwner)item.cloudOwner=data.user.id;await chrome.storage.local.set({[QUEUE]:queue});});
  await pushCloud();return{ok:true,email:data.user.email};
 }
 if(message.type==='SHIGUANG_CLOUD_LOGOUT'){
  await pushCloud();const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;await chrome.storage.local.remove('shiguang.extension.owner');return{ok:true};
 }
 if(message.type==='SHIGUANG_CLOUD_PUSH')return pushCloud();
 throw Error('无法识别的请求');
}
