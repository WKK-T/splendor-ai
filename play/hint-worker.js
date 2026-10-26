/* Dedicated worker: the only inputs are a filtered observation and public data.
   WasmAnalysis seals at a draw/reveal, so synthetic unknown cards never become
   policy features. The live WasmGame never enters this worker. */
let network, data, init;
self.onmessage=async ({data:message})=>{
  try{
    if(message.type==='init'){
      init=(async()=>{
        const raw=Uint8Array.from(atob(message.wasm),c=>c.charCodeAt(0));
        await wasm_bindgen({module_or_path:raw.buffer});
        network=SplendorTransformer.create(message.metadata,message.weights);
        data=message.staticData;
      })();
      await init; self.postMessage({type:'ready'}); return;
    }
    if(message.type!=='hint')return;
    await init;
    const {snapshot, binding}=message;
    let sandbox;
    try{
      sandbox=new wasm_bindgen.WasmAnalysis(JSON.stringify(snapshot));
      const steps=[], awards=[];
      let result, initialMask;
      for(let n=0;n<32;n++){
        const state=JSON.parse(sandbox.observation_json());
        const mask=Array.from(sandbox.mask());
        if(!n)initialMask=mask;
        const index=network.choose(sandbox.encode(),mask);
        if(!mask[index])throw new Error('规则校验未通过');
        steps.push({index,phase:state.phase,text:SplendorHintText.describe(state,index,data),
          paymentColor:state.pending_purchase?.remaining_cost.findIndex(v=>v>0)??null});
        result=JSON.parse(sandbox.step(index));
        if(index<66||index>=76)awards.push(...result.nobles);
        if(result.ended||result.unknown_boundary)break;
      }
      if(!result?.ended&&!result?.unknown_boundary)throw new Error('结算步骤超出分析上限');
      const lines=SplendorHintText.summarize(steps);
      for(const id of awards)lines.push(`自动迎来贵族，获得 ${data.nobles[id].points} 分。`);
      self.postMessage({type:'hint',binding,steps,lines,initialMask,
        complete:result.ended, boundary:result.unknown_boundary,
        note:result.ended?'以上步骤已由规则引擎验证。':`以上步骤已验证；牌面揭晓后${result.next_phase==='Discard'?'需继续归还筹码':result.next_phase==='ChooseNoble'?'需继续选择贵族':'需继续结算'}，请重新获取提示。`});
    }finally{sandbox?.free();}
  }catch(error){self.postMessage({type:'error',binding:message.binding,message:error.message||String(error)});}
};
