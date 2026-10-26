/* Lazily decoded and cached per model; expensive computation never runs in UI. */
const OPPONENT_WORKER_SOURCE=__OPPONENT_WORKER_JSON__;
const policyClients=new Map();
let policyRequestId=0,lastPolicyDecision=null;
function stopPolicyClient(key,error){
 const client=policyClients.get(key);if(!client)return;
 policyClients.delete(key);client.worker.terminate();
 for(const request of client.pending.values()){clearTimeout(request.timer);request.reject(error);}
 client.pending.clear();
}
function cancelPolicyRequests(){
 if(LOCAL_GAME)cancelLocalRequests('opponent');
 for(const [key,client] of policyClients)if(client.pending.size)stopPolicyClient(key,new Error('对局已更新'));
 lastPolicyDecision=null;
}
function policyClient(key){
 if(policyClients.has(key))return policyClients.get(key);
 const bundle=POLICY_BUNDLES[key];if(!bundle)throw new Error('未知的策略模型');
 const url=URL.createObjectURL(new Blob([OPPONENT_WORKER_SOURCE],{type:'text/javascript'}));
 let worker;try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
 const client={worker,pending:new Map(),ready:false,modelId:bundle.metadata.model_id};policyClients.set(key,client);
 worker.onmessage=({data:r})=>{
  if(policyClients.get(key)!==client)return;
  if(r.type==='ready'){
   if(r.model_id!==bundle.metadata.model_id||r.weights_sha256!==bundle.metadata.weights_sha256){stopPolicyClient(key,new Error('载入的模型版本不匹配'));return;}
   client.ready=true;return;
  }
  if(r.type==='error'&&!r.id){stopPolicyClient(key,new Error(r.message));return;}
  const request=client.pending.get(r.id);if(!request)return;
  client.pending.delete(r.id);clearTimeout(request.timer);
  if(r.type==='error'){request.reject(new Error(r.message));return;}
  if(r.type!=='choice'||JSON.stringify(r.binding)!==JSON.stringify(request.binding)||!Number.isInteger(r.index)||!request.mask[r.index]){request.reject(new Error('模型行动校验失败'));return;}
  lastPolicyDecision={...r.binding,index:r.index,elapsed_ms:r.elapsed_ms};request.resolve(r.index);
 };
 worker.onerror=()=>stopPolicyClient(key,new Error('模型计算未能启动，请重新开局'));
 worker.postMessage({type:'init',metadata:bundle.metadata,weights:bundle.weights});
 return client;
}
function choosePolicyAction(key,observation,mask,binding){
 const client=policyClient(key),id=++policyRequestId;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>stopPolicyClient(key,new Error('模型计算超时，请重新开局')),30000);
  client.pending.set(id,{resolve,reject,timer,binding,mask:Array.from(mask)});
  client.worker.postMessage({type:'choose',id,binding,observation:Array.from(observation),mask:Array.from(mask)});
 });
}
