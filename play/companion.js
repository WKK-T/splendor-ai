/* Web companion UI; no desktop pet integration, no automatic game actions. */
const COMPANIONS = __COMPANIONS_JSON__;
const COMPANION_STYLES = [
  {id:'pet',name:'圆晶伙伴',note:'圆润晶面 · 轻巧活泼'},
  {id:'classic',name:'长晶伙伴',note:'修长晶面 · 简洁明亮'}
];
const HINT_WORKER_SOURCE = __HINT_WORKER_JSON__;
const HINT_ADAPTER_VERSION = 'visible-sandbox/1';
let actionRevision = 0;
const hintState = {worker:null,pending:null,result:null,requestSerial:0};
const companionPrefKey = 'splendor-companion-v1';
let companionPrefs;
try { companionPrefs = JSON.parse(localStorage.getItem(companionPrefKey)||'{}'); } catch { companionPrefs = {}; }
if(!companionPrefs || typeof companionPrefs!=='object')companionPrefs={};
if(!COMPANIONS.some(c=>c.id===companionPrefs.character))companionPrefs.character=COMPANIONS[0].id;
if(!COMPANION_STYLES.some(s=>s.id===companionPrefs.style))companionPrefs.style='pet';
// Size baseline v2: 100% is the former 150%; adopt the new default once.
if(companionPrefs.sizeBaseline!==2){companionPrefs.size=100;companionPrefs.sizeBaseline=2;}
companionPrefs.size=Number.isFinite(companionPrefs.size)?Math.max(60,Math.min(200,Math.round(companionPrefs.size/10)*10)):100;
let companionPosition={x:0,y:0}, companionDrag=null, suppressCompanionClick=false;
function saveCompanionPrefs(){try{localStorage.setItem(companionPrefKey,JSON.stringify(companionPrefs));}catch{}}
function hintBinding(){return {session:sessionVersion,revision:actionRevision,actor:humanSeat,phase:game.phase(),
  policy:LOCAL_GAME?localHintProfile:HINT_POLICY_META.model_id,policy_hash:LOCAL_GAME?POLICY_BUNDLES[localHintProfile]?.metadata.weights_sha256:HINT_POLICY_META.weights_sha256,rules:'base-v2',
  adapter:HINT_ADAPTER_VERSION};}
function bindingKey(binding){return JSON.stringify(binding);}
function hintIsCurrent(binding){return !!game&&bindingKey(binding)===bindingKey(hintBinding());}
function cancelHintWork(){
  if(LOCAL_GAME)cancelLocalRequests('hint');
  if(hintState.pending){hintState.worker?.terminate();hintState.worker=null;hintState.pending=null;}
}
function invalidateHint(){
  actionRevision++;cancelHintWork();hintState.result=null;
  if($('hint-result')){$('hint-result').textContent=LOCAL_GAME&&localHintProfile==='off'?'教学提示已关闭，可在设置中开启。':'局面已更新，点击“提示”获取当前建议。';}
  refreshCompanionControls();
}
function companionCanHint(){return (!LOCAL_GAME||localHintProfile!=='off')&&!!game&&game.current()===humanSeat&&game.phase()!=='GameOver'&&!aiThinking&&!humanBusy&&!gameError;}
function refreshCompanionControls(){
  if(!$('hint-get'))return;
  $('hint-get').disabled=!companionCanHint()||!!hintState.pending;
  $('hint-get').textContent=hintState.pending?'分析中…':hintState.result?'查看提示':'提示';
  const context=!game?'牌桌加载中':game.phase()==='GameOver'?'本局已结束':game.current()!==humanSeat?'等待你的回合':humanBusy||aiThinking?'等待行动结算':'';
  $('companion-context').textContent=context;$('companion-context').hidden=!context;
}
function createHintWorker(){
  const url=URL.createObjectURL(new Blob([HINT_WORKER_SOURCE],{type:'text/javascript'}));
  let worker;
  try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
  worker.postMessage({type:'init',metadata:HINT_POLICY_META,weights:HINT_POLICY_BASE64,wasm:WASM_B64,staticData:STATIC});
  worker.onmessage=({data:r})=>{
    if(r.type==='ready')return;
    if(worker!==hintState.worker||!hintState.pending)return;
    if(r.binding&&(!hintIsCurrent(r.binding)||bindingKey(r.binding)!==bindingKey(hintState.pending)))return;
    hintState.pending=null;
    if(r.type==='error'){$('hint-result').textContent=`提示暂不可用：${r.message}`;worker.terminate();hintState.worker=null;refreshCompanionControls();return;}
    const legal=Array.from(game.mask());
    if(!r.steps?.length||!legal[r.steps[0].index]||JSON.stringify(legal)!==JSON.stringify(r.initialMask)){
      $('hint-result').textContent='局面校验未通过，请重新获取提示。';refreshCompanionControls();return;
    }
    r.actionKey=JSON.stringify({binding:r.binding,steps:r.steps.map(s=>({index:s.index,phase:s.phase,paymentColor:s.paymentColor})),complete:r.complete});
    hintState.result=r;renderHintResult();refreshCompanionControls();
  };
  worker.onerror=()=>{if(worker!==hintState.worker)return;cancelHintWork();$('hint-result').textContent='提示计算未能启动，请重试。';refreshCompanionControls();};
  return worker;
}
function renderHintResult(){
  const r=hintState.result;if(!r)return;
  const title=document.createElement('strong');title.textContent=LOCAL_GAME?'AI建议行动':r.complete?'本回合剩余步骤':'当前可确定步骤';
  const list=document.createElement('ol');for(const line of r.lines){const li=document.createElement('li');li.textContent=line;list.append(li);}
  $('hint-result').replaceChildren(title,list);
  if(r.note){const note=document.createElement('p');note.className='hint-note';note.textContent=r.note;$('hint-result').append(note);}
}
function requestHint(){
  if(LOCAL_GAME){void requestLocalHint();return;}
  if(!companionCanHint())return;
  if(turnDeadline&&Date.now()>=turnDeadline){void expireHumanTurn();return;}
  if(hintState.result&&hintIsCurrent(hintState.result.binding)){renderHintResult();return;}
  if(hintState.pending)return;
  const binding=hintBinding(), snapshot=currentState();
  hintState.pending=binding;hintState.requestSerial++;
  $('hint-result').textContent='正在验证当前可见局面的行动…';
  try{
    if(!hintState.worker)hintState.worker=createHintWorker();
    hintState.worker.postMessage({type:'hint',binding,snapshot});
  }catch(error){cancelHintWork();$('hint-result').textContent='提示暂不可用：'+error.message;}
  refreshCompanionControls();
}
const companionHitPaths = new Map();
function updateCompanionHitArea(){
  const img=$('companion-image');
  if(!img.complete||!img.naturalWidth)return;
  let path=companionHitPaths.get(img.src);
  if(!path){
    // Match object-fit:contain; transparent pixels must let board clicks through.
    const width=105,height=141,canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const scale=Math.min(width/img.naturalWidth,height/img.naturalHeight);
    const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
    ctx.drawImage(img,(width-w)/2,(height-h)/2,w,h);
    const pixels=ctx.getImageData(0,0,width,height).data,segments=[];
    const unit=(n,d)=>(n/d).toFixed(5);
    for(let y=0;y<height;y++){
      for(let x=0;x<width;){
        if(pixels[(y*width+x)*4+3]<24){x++;continue;}
        const start=x;
        while(x<width&&pixels[(y*width+x)*4+3]>=24)x++;
        segments.push(`M${unit(start,width)} ${unit(y,height)}H${unit(x,width)}V${unit(y+1,height)}H${unit(start,width)}Z`);
      }
    }
    path=segments.join('');companionHitPaths.set(img.src,path);
  }
  $('companion-hit-path').setAttribute('d',path);
  img.style.pointerEvents='auto';
}
function bindCompanionDrag(handle,canDrag=()=>true){
  const pet=$('companion');
  handle.onpointerdown=e=>{
    suppressCompanionClick=false;
    if(e.button!==0||!e.isPrimary||!canDrag())return;
    companionDrag={handle,id:e.pointerId,x:e.clientX,y:e.clientY,start:{...companionPosition},moved:false};
    handle.setPointerCapture(e.pointerId);
  };
  handle.onpointermove=e=>{
    const d=companionDrag;if(!d||d.handle!==handle||d.id!==e.pointerId)return;
    const dx=e.clientX-d.x,dy=e.clientY-d.y;
    if(Math.hypot(dx,dy)>5)d.moved=true;
    if(d.moved){pet.classList.add('dragging');placeCompanion(d.start.x+dx,d.start.y+dy);}
  };
  const endDrag=e=>{
    if(companionDrag?.handle!==handle||companionDrag.id!==e.pointerId)return;
    suppressCompanionClick=companionDrag.moved;companionDrag=null;
    pet.classList.remove('dragging');placeCompanion(companionPosition.x,companionPosition.y,true);
  };
  handle.onpointerup=endDrag;handle.onpointercancel=endDrag;handle.onlostpointercapture=endDrag;
  handle.onkeydown=e=>{
    const delta={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[e.key];
    if(delta){e.preventDefault();placeCompanion(companionPosition.x+delta[0],companionPosition.y+delta[1],true);}
    if(e.key==='Home'){e.preventDefault();resetCompanionPosition();}
  };
}
function setCompanionCharacter(id){
  const selected=COMPANIONS.find(c=>c.id===id);if(!selected)return;
  companionPrefs.character=id;saveCompanionPrefs();
  $('companion-image').onload=updateCompanionHitArea;
  $('companion-image').style.pointerEvents='none';
  $('companion-image').src=selected.styles[companionPrefs.style].src;$('companion-image').alt='';
  updateCompanionHitArea();
  $('companion-size-preview').src=$('companion-image').src;
  $('companion').dataset.style=companionPrefs.style;
  $('companion-name').textContent=selected.name;
  $('companion-toggle').setAttribute('aria-label',`${selected.name}：打开提示；方向键移动，Home 回到角落`);
  document.querySelectorAll('[data-companion]').forEach(b=>{
    b.setAttribute('aria-pressed',String(b.dataset.companion===id));
    b.querySelector('img').src=COMPANIONS.find(c=>c.id===b.dataset.companion).styles[companionPrefs.style].src;
  });
  document.querySelectorAll('[data-companion-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.companionStyle===companionPrefs.style)));
}
function setCompanionStyle(style){
  if(!COMPANION_STYLES.some(s=>s.id===style))return;
  companionPrefs.style=style;
  setCompanionCharacter(companionPrefs.character);
}
function setCompanionSize(value,persist=true){
  const size=Number(value);
  if(!Number.isFinite(size))return;
  const before=$('companion').getBoundingClientRect();
  companionPrefs.size=Math.max(60,Math.min(200,Math.round(size/10)*10));
  document.documentElement.style.setProperty('--companion-scale',String(companionPrefs.size/100));
  $('companion-size').value=companionPrefs.size;
  $('companion-size-value').textContent=companionPrefs.size+'%';
  $('companion-size').setAttribute('aria-valuetext',companionPrefs.size+'%');
  const after=$('companion').getBoundingClientRect();
  // Keep its feet and horizontal centre anchored while changing size.
  placeCompanion(companionPosition.x+(before.width-after.width)/2,companionPosition.y+before.height-after.height,persist);
  if(persist)saveCompanionPrefs();
}
function placeCompanion(x,y,persist=false){
  const pet=$('companion'), rect=pet.getBoundingClientRect(), w=rect.width,h=rect.height;
  companionPosition={x:Math.max(6,Math.min(innerWidth-w-6,Number.isFinite(x)?x:6)),y:Math.max(6,Math.min(innerHeight-h-6,Number.isFinite(y)?y:6))};
  pet.style.left=companionPosition.x+'px';pet.style.top=companionPosition.y+'px';
  if(persist){companionPrefs.position={x:companionPosition.x/innerWidth,y:companionPosition.y/innerHeight};saveCompanionPrefs();}
  positionCompanionPanel();
}
function resetCompanionPosition(){
  const r=$('companion').getBoundingClientRect();
  placeCompanion(innerWidth<=700?innerWidth-r.width-8:12,innerHeight-r.height-10,true);
}
function positionCompanionPanel(){
  const panel=$('companion-panel');if(!panel||panel.hidden)return;
  const r=$('companion').getBoundingClientRect(), p=panel.getBoundingClientRect();
  const fitsRight=r.right+12+p.width<=innerWidth-8, fitsLeft=r.left-p.width-12>=8;
  const x=fitsRight?r.right+12:fitsLeft?r.left-p.width-12:Math.max(8,Math.min(r.left,innerWidth-p.width-8));
  let y=r.bottom-p.height;
  if(!fitsRight&&!fitsLeft){
    if(r.top-p.height-12>=8)y=r.top-p.height-12;
    else if(r.bottom+p.height+12<=innerHeight-8)y=r.bottom+12;
  }
  panel.style.left=Math.min(x,Math.max(8,innerWidth-p.width-8))+'px';
  panel.style.top=Math.max(8,Math.min(innerHeight-p.height-8,y))+'px';
}
function toggleCompanionPanel(open=$('companion-panel').hidden){
  // Explicit true opens, false closes.
  $('companion-panel').hidden=!open;$('companion-toggle').setAttribute('aria-expanded',String(open));
  if(open){refreshCompanionControls();positionCompanionPanel();$('hint-get').disabled?$('companion-panel-close').focus():$('hint-get').focus();}
}
function applyCompanionCollapse(){
  $('companion').classList.toggle('collapsed',!!companionPrefs.collapsed);
  $('companion-collapse').textContent=companionPrefs.collapsed?'展开':'−';
  $('companion-collapse').setAttribute('aria-label',companionPrefs.collapsed?'展开角色':'收起角色');
  if(companionPrefs.collapsed)toggleCompanionPanel(false);
  placeCompanion(companionPosition.x,companionPosition.y);saveCompanionPrefs();
}
function initCompanion(){
  document.querySelector('.hint-provenance').textContent=LOCAL_GAME?localHintLabel():HINT_RELEASE.label;
  const styles=$('companion-styles');
  for(const style of COMPANION_STYLES){
    const b=document.createElement('button');b.type='button';b.dataset.companionStyle=style.id;b.className='companion-style-choice';
    const im=document.createElement('img');im.src=COMPANIONS[0].styles[style.id].src;im.alt='';
    const text=document.createElement('span'),title=document.createElement('strong'),note=document.createElement('small');
    title.textContent=style.name;note.textContent=style.note;text.append(title,note);b.append(im,text);
    b.onclick=()=>setCompanionStyle(style.id);styles.append(b);
  }
  const choices=$('companion-choices');
  for(const c of COMPANIONS){
    const b=document.createElement('button');b.type='button';b.dataset.companion=c.id;b.className='companion-choice';
    const im=document.createElement('img');im.src=c.styles[companionPrefs.style].src;im.alt='';const label=document.createElement('span');label.textContent=c.name;b.append(im,label);
    b.onclick=()=>setCompanionCharacter(c.id);choices.append(b);
  }
  setCompanionCharacter(companionPrefs.character);
  const toggle=$('companion-toggle'),collapse=$('companion-collapse');
  const wasDragged=e=>{const dragged=suppressCompanionClick&&e.detail!==0;suppressCompanionClick=false;return dragged;};
  toggle.onclick=e=>{if(!wasDragged(e))toggleCompanionPanel($('companion-panel').hidden);};
  bindCompanionDrag(toggle);
  bindCompanionDrag(collapse,()=>companionPrefs.collapsed);
  collapse.onclick=e=>{if(wasDragged(e))return;companionPrefs.collapsed=!companionPrefs.collapsed;applyCompanionCollapse();};
  $('companion-panel-close').onclick=()=>{toggleCompanionPanel(false);toggle.focus();};
  $('companion-panel').onkeydown=e=>{if(e.key==='Escape'){toggleCompanionPanel(false);toggle.focus();}};
  $('companion-reset').onclick=()=>{companionPrefs.collapsed=false;applyCompanionCollapse();resetCompanionPosition();};
  $('hint-get').onclick=requestHint;
  $('companion-size').oninput=()=>setCompanionSize(Number($('companion-size').value));
  $('companion-size-default').onclick=()=>setCompanionSize(100);
  setCompanionSize(companionPrefs.size,false);
  if(companionPrefs.position)placeCompanion(companionPrefs.position.x*innerWidth,companionPrefs.position.y*innerHeight);else resetCompanionPosition();
  applyCompanionCollapse();
  window.addEventListener('resize',()=>{placeCompanion(companionPosition.x,companionPosition.y);});
  new ResizeObserver(positionCompanionPanel).observe($('companion-panel'));
  refreshCompanionControls();
}
