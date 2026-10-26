/* The active game stays on the UI thread; inference sees only encoded inputs. */
let network;
self.onmessage=({data:m})=>{
 try{
  if(m.type==='init'){
   network=SplendorTransformer.create(m.metadata,m.weights);
   self.postMessage({type:'ready',model_id:network.metadata.model_id,weights_sha256:network.metadata.weights_sha256});return;
  }
  if(m.type!=='choose')return;
  if(!network)throw new Error('模型尚未载入');
  if(m.binding.model_id!==network.metadata.model_id||m.binding.weights_sha256!==network.metadata.weights_sha256)throw new Error('模型版本绑定不匹配');
  const start=performance.now(),index=network.choose(m.observation,m.mask);
  self.postMessage({type:'choice',id:m.id,binding:m.binding,index,elapsed_ms:performance.now()-start});
 }catch(error){self.postMessage({type:'error',id:m.id,binding:m.binding,message:error.message||String(error)});}
};
