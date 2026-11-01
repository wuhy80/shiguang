'use strict';
const transport=window.ShiguangCaptureTransport||chrome.runtime,closeCapture=()=>window.ShiguangCloseCapture?window.ShiguangCloseCapture():window.close();
const id=new URLSearchParams(location.search).get('draft'),status=document.getElementById('status'),save=document.getElementById('save');
const input=document.getElementById('tags'),options=document.getElementById('categories'),selectedBox=document.getElementById('selected-tags');
let known=[],selected=[],active=-1,collection=null;
function hideCategories(){options.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
function addCategory(value){
 const tag=value.trim().slice(0,60);if(!tag)return;
 if(!selected.includes(tag)&&selected.length<20)selected.push(tag);
 if(!known.includes(tag))known.push(tag);
 input.value='';renderSelected();renderCategories();input.focus();
}
function renderSelected(){
 selectedBox.replaceChildren();
 for(const tag of selected){const chip=document.createElement('button');chip.type='button';chip.className='category-chip';chip.textContent=tag+' ×';chip.setAttribute('aria-label','移除分类 '+tag);chip.onclick=()=>{selected=selected.filter(x=>x!==tag);renderSelected();renderCategories();};selectedBox.append(chip);}
}
function renderCategories(){
 const query=input.value.trim();options.replaceChildren();active=-1;input.removeAttribute('aria-activedescendant');
 const matches=known.filter(tag=>!selected.includes(tag)&&tag.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const choices=matches.map(tag=>({tag,label:tag}));
 if(query&&!known.includes(query))choices.push({tag:query,label:'＋ 创建分类「'+query+'」'});
 for(const [index,choice] of choices.entries()){
 const button=document.createElement('button');button.type='button';button.role='option';button.id='category-option-'+index;button.setAttribute('aria-selected','false');button.textContent=choice.label;button.onclick=()=>addCategory(choice.tag);options.append(button);
 }
 if(!choices.length){const empty=document.createElement('p');empty.className='category-empty';empty.textContent=query?'该分类已选中':'输入名称，创建你的第一个分类';options.append(empty);}
 options.hidden=false;input.setAttribute('aria-expanded','true');
}
input.addEventListener('focus',renderCategories);input.addEventListener('input',renderCategories);
document.getElementById('toggle-categories').onclick=()=>{if(options.hidden){input.focus();renderCategories();}else hideCategories();};
input.addEventListener('keydown',event=>{
 if(event.isComposing)return;
 if(event.key==='Escape'&&!options.hidden){event.preventDefault();event.stopPropagation();hideCategories();return;}
 if(event.key==='ArrowDown'||event.key==='ArrowUp'){
 event.preventDefault();if(options.hidden)renderCategories();const buttons=[...options.querySelectorAll('button')];if(!buttons.length)return;
 active=(active+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
 buttons.forEach((button,index)=>button.setAttribute('aria-selected',String(index===active)));input.setAttribute('aria-activedescendant',buttons[active].id);buttons[active].scrollIntoView({block:'nearest'});
 }
 if(event.key==='Enter'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();const buttons=[...options.querySelectorAll('button')];if(!options.hidden&&active>=0)buttons[active]?.click();else if(input.value.trim())addCategory(input.value);else hideCategories();}
});
document.addEventListener('click',event=>{if(!event.target.closest('.category-picker')&&!event.target.closest('.category-chip'))hideCategories();});
document.getElementById('cancel').onclick=()=>closeCapture();
async function load(){
 try{
  const draft=await transport.sendMessage({type:'SHIGUANG_CAPTURE_GET',id});
  if(draft?.error)throw Error(draft.error);if(!draft?.url)throw Error('未找到待收藏网页');
  document.getElementById('title').textContent=draft.title;document.getElementById('url').textContent=draft.url;
  const cover=document.getElementById('cover');
  if(draft.thumbnail){cover.hidden=false;cover.textContent='封面：'+(draft.coverSource||'网页封面');}else cover.hidden=true;
  known=[...new Set(draft.tags||[])];
  if(draft.selection){document.getElementById('excerpt').hidden=false;document.getElementById('selection').textContent=draft.selection;}
  collection=draft.collection||null;
  if(collection){document.getElementById('collection-toggle').hidden=false;document.getElementById('collection-name').textContent='检测到：'+(collection.title||collection.url)+(collection.episodes?'（含 '+collection.episodes.length+' 集）':'（合集链接与标题，每集可在合集页再存一次补全）');}
  save.disabled=false;document.getElementById('tags').focus();
 }catch(error){status.textContent=error.message;}
}
document.getElementById('capture-form').onsubmit=async event=>{
 event.preventDefault();if(save.disabled)return;if(input.value.trim())addCategory(input.value);hideCategories();save.disabled=true;status.textContent='正在保存…';
 try{
  const result=await transport.sendMessage({type:'SHIGUANG_CAPTURE_SAVE',id,tags:selected.join('，'),reason:document.getElementById('reason').value,asCollection:collection?document.getElementById('as-collection').checked:undefined});
  if(!result?.ok)throw Error(result?.error||'未保存，请重试');
  status.textContent=result.duplicate?'这条内容已收藏，保留原有笔记。':'已收下，联网后自动同步。';
  setTimeout(()=>closeCapture(),900);
 }catch(error){status.textContent=error.message;save.disabled=false;}
};
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeCapture();if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();document.getElementById('capture-form').requestSubmit();}});
load();
