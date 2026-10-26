/* Local browser game transport. Only filtered observations cross this boundary. */
const localPending=new Map();
let localSerial=0,localHintProfile='medium';
const localClientId=crypto.randomUUID();
function localModelNote(key){
  if(key==='easy')return 'Transformer 模型，约 126 万参数，100M 训练';
  if(key==='medium')return 'Transformer 模型，约 126 万参数，200M 训练';
  return `Transformer 模型 + MCTS 搜索 ${key==='hard'?128:256} 次，约 1299 万参数，2048 局训练`;
}
function localHintLabel(){return localHintProfile==='off'?'教学提示已关闭':`提示模型：${POLICY_BUNDLES[localHintProfile].metadata.display_name}`;}
function cancelLocalRequests(purpose){
  for(const [id,p] of localPending){
    if(p.purpose!==purpose)continue;
    p.controller.abort();localPending.delete(id);
    void fetch('/api/cancel',{method:'POST',headers:{'Content-Type':'application/json','X-Splendor-Local':'1'},body:JSON.stringify({request_id:id}),keepalive:true}).catch(()=>{});
  }
}
async function requestLocalAction(profile,snapshot,mask,binding,purpose){
  const id=`${localClientId}:${++localSerial}`,controller=new AbortController();
  localPending.set(id,{controller,purpose});
  const timer=setTimeout(()=>controller.abort(),120000);
  try{
    const response=await fetch(LOCAL_GAME.api,{method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json','X-Splendor-Local':'1'},
      body:JSON.stringify({request_id:id,profile,observation:snapshot,legal_mask:mask,binding})});
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'本地模型服务暂不可用');
    const r=data.result;
    if(data.request_id!==id||JSON.stringify(data.binding)!==JSON.stringify(binding)||!Number.isInteger(r.index)||!mask[r.index]||JSON.stringify(r.mask)!==JSON.stringify(mask))throw new Error('局面或模型行动校验失败');
    if(purpose==='opponent')lastPolicyDecision={...binding,index:r.index,elapsed_ms:r.wall_seconds*1000,simulations:r.simulations};
    return r;
  }catch(error){
    if(error.name==='AbortError')throw error;
    if(error instanceof TypeError)throw new Error('无法连接本地模型，请保持启动窗口开启。');
    throw error;
  }finally{clearTimeout(timer);localPending.delete(id);}
}
async function requestLocalHint(){
  if(!companionCanHint())return;
  if(turnDeadline&&Date.now()>=turnDeadline){void expireHumanTurn();return;}
  if(hintState.result&&hintIsCurrent(hintState.result.binding)){renderHintResult();return;}
  if(hintState.pending)return;
  const binding=hintBinding(),snapshot=currentState(),mask=Array.from(game.mask());
  hintState.pending=binding;
  $('hint-result').textContent='模型正在思考下一步…';refreshCompanionControls();
  try{
    const r=await requestLocalAction(localHintProfile,snapshot,mask,binding,'hint');
    if(!hintIsCurrent(binding)||hintState.pending!==binding)return;
    const text=SplendorHintText.describe(snapshot,r.index,STATIC);
    hintState.result={binding,steps:[{index:r.index,phase:snapshot.phase,text}],lines:[text],complete:false};
    renderHintResult();
  }catch(error){
    if(hintState.pending===binding&&error.name!=='AbortError')$('hint-result').textContent='提示暂不可用：'+error.message;
  }finally{if(hintState.pending===binding)hintState.pending=null;refreshCompanionControls();}
}
function setLocalHintProfile(profile){
  localHintProfile=profile==='off'||Object.hasOwn(POLICY_BUNDLES,profile)?profile:'medium';
  cancelHintWork();hintState.result=null;
  try{localStorage.setItem('splendor-local-hint-v1',localHintProfile);}catch{}
  document.querySelector('.hint-provenance').textContent=localHintLabel();
  $('hint-result').textContent=localHintProfile==='off'?'教学提示已关闭，可在设置中开启。':'提示模型已切换，点击“提示”获取建议。';
  $('local-hint-note').textContent=localHintProfile==='off'?'关闭提示不影响对手。':localModelNote(localHintProfile);
  refreshCompanionControls();
}
async function initLocalGame(){
  const response=await fetch('/api/health');
  if(!response.ok)throw new Error('请通过“启动游戏”打开本地版。');
  const health=await response.json();
  if(health.app!=='splendor-local-game/1')throw new Error('本地服务版本不匹配');
  const opponent=$('opponent-select');opponent.replaceChildren(new Option('简单机器人','simple'));
  for(const [key,bundle] of Object.entries(POLICY_BUNDLES))opponent.add(new Option(bundle.metadata.display_name,key));
  const label=document.createElement('label');label.className='field-label';label.htmlFor='local-hint-select';label.textContent='教学提示模型';
  const select=document.createElement('select');select.id='local-hint-select';select.add(new Option('关闭教学提示','off'));
  for(const [key,bundle] of Object.entries(POLICY_BUNDLES))select.add(new Option(bundle.metadata.display_name,key));
  const note=document.createElement('p');note.className='field-note';note.id='local-hint-note';
  $('opponent-note').after(label,select,note);
  try{localHintProfile=localStorage.getItem('splendor-local-hint-v1')||'medium';}catch{}
  setLocalHintProfile(localHintProfile);select.value=localHintProfile;
  select.onchange=()=>setLocalHintProfile(select.value);
  document.title='璀璨宝石 · 本地版';
}
