/* Original transformer160x4, all float32 weights retained. Worker-only CPU
 * inference; no network, external runtime, quantization or distilled model. */
(function(root){
'use strict';
const D=160,N=20,H=8,K=20,F=640;
const FIXED=[...Array(30).keys(),42,43,44,...Array.from({length:23},(_,i)=>60+i)];
const ROLES=[0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,4,4,4,5,6];
const fail=message=>{throw new Error('Transformer：'+message)};
  function sha256(bytes) {
    const k = new Uint32Array([
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ]);
    const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
      0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    data.set(bytes); data[bytes.length] = 0x80;
    const view = new DataView(data.buffer);
    view.setUint32(data.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(data.length - 4, (bytes.length * 8) >>> 0);
    const w = new Uint32Array(64);
    const rotr = (n, s) => (n >>> s) | (n << (32 - s));
    for (let offset = 0; offset < data.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = w[i - 16] + (rotr(a,7) ^ rotr(a,18) ^ (a >>> 3)) + w[i - 7]
          + (rotr(b,17) ^ rotr(b,19) ^ (b >>> 10));
      }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (j + (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25))
          + ((e & f) ^ (~e & g)) + k[i] + w[i]) >>> 0;
        const t2 = ((rotr(a,2) ^ rotr(a,13) ^ rotr(a,22))
          + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        j=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      const next = [a,b,c,d,e,f,g,j];
      for (let i = 0; i < 8; i++) h[i] += next[i];
    }
    return Array.from(h, n => n.toString(16).padStart(8, '0')).join('');
  }

function expectedParameters(){
 const p=[['card.weight',[D,12]],['card.bias',[D]],['reserve_meta.weight',[D,3]],['global_encoder.weight',[D,69]],['global_encoder.bias',[D]],['roles.weight',[7,D]]];
 for(let i=0;i<4;i++)for(const [name,shape] of [
  ['self_attn.in_proj_weight',[3*D,D]],['self_attn.in_proj_bias',[3*D]],['self_attn.out_proj.weight',[D,D]],['self_attn.out_proj.bias',[D]],
  ['linear1.weight',[F,D]],['linear1.bias',[F]],['linear2.weight',[D,F]],['linear2.bias',[D]],
  ['norm1.weight',[D]],['norm1.bias',[D]],['norm2.weight',[D]],['norm2.bias',[D]]])p.push([`blocks.${i}.${name}`,shape]);
 for(const [name,shape] of [['norm.weight',[D]],['norm.bias',[D]],['fixed.weight',[56,D]],['fixed.bias',[56]],['buy.weight',[1,D]],['buy.bias',[1]],['reserve.weight',[1,D]],['reserve.bias',[1]],['value.weight',[1,D]],['value.bias',[1]]])p.push([name,shape]);
 return p;
}
function create(metadata,base64){
 if(!metadata||metadata.format!=='splendor-browser-transformer/1'||metadata.architecture!=='transformer160x4'||metadata.width!==D||metadata.blocks!==4||metadata.heads!==H||metadata.ff_width!==F||metadata.tokens!==N||metadata.norm_first!==true||metadata.layer_norm_eps!==1e-5||metadata.activation!=='gelu-exact'||metadata.dropout!==0||metadata.dtype!=='float32-le'||metadata.quantization!==null||metadata.parameter_count!==1261819||metadata.byte_length!==1261819*4||metadata.selection!=='legal-mask-argmax-lowest-index-tie')fail('模型结构不兼容');
 if(metadata.encoding_version!==2||metadata.obs_len!==315||metadata.num_actions!==83||metadata.num_players!==2||metadata.ruleset!=='base'||metadata.action_schema!=='splendor-v2-83'||JSON.stringify(metadata.roles)!==JSON.stringify(ROLES)||JSON.stringify(metadata.fixed_ids)!==JSON.stringify(FIXED))fail('观察编码或动作映射不兼容');
 if(typeof base64!=='string'||base64.length!==4*Math.ceil(metadata.byte_length/3))fail('权重长度不符');
 const raw=atob(base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(bytes.length!==metadata.byte_length||sha256(bytes)!==metadata.weights_sha256)fail('权重校验失败');
 const view=new DataView(bytes.buffer),weights=new Float32Array(metadata.parameter_count);
 for(let i=0;i<weights.length;i++){weights[i]=view.getFloat32(i*4,true);if(!Number.isFinite(weights[i]))fail('权重包含无效数值');}
 const expected=expectedParameters(),p={};let offset=0;
 if(metadata.parameters?.length!==expected.length)fail('参数表不完整');
 expected.forEach(([name,shape],i)=>{const entry=metadata.parameters[i],length=shape.reduce((a,b)=>a*b,1);if(entry.name!==name||JSON.stringify(entry.shape)!==JSON.stringify(shape)||entry.length!==length||entry.offset!==offset)fail('参数布局不兼容');p[name]=weights.subarray(offset,offset+length);offset+=length;});
 if(offset!==weights.length)fail('参数数量不兼容');
 const info=JSON.parse(JSON.stringify(metadata));
 // Positive-term erf series avoids cancellation; no tanh GELU approximation.
 function gelu(x){
  if(x>8)return x;if(x< -8)return 0;
  const z=Math.abs(x)/Math.SQRT2,z2=2*z*z;
  let term=1,sum=1;
  for(let n=1;n<160;n++){term*=z2/(2*n+1);const next=sum+term;if(next===sum)break;sum=next;}
  const erf=2/Math.sqrt(Math.PI)*z*Math.exp(-z*z)*sum;
  return .5*x*(1+(x<0?-erf:erf));
 }
 function linear(x,rows,input,output,w,b){
  const y=new Float32Array(rows*output);
  for(let r=0;r<rows;r++)for(let o=0;o<output;o++){
   let sum=b?b[o]:0,wi=o*input,xi=r*input;
   for(let j=0;j<input;j++)sum+=x[xi+j]*w[wi+j];
   y[r*output+o]=sum;
  }return y;
 }
 function norm(x,w,b){
  const y=new Float32Array(x.length);
  for(let r=0;r<N;r++){
   let mean=0,variance=0,start=r*D;
   for(let i=0;i<D;i++)mean+=x[start+i];mean/=D;
   for(let i=0;i<D;i++){const d=x[start+i]-mean;variance+=d*d;}
   const inv=1/Math.sqrt(variance/D+1e-5);
   for(let i=0;i<D;i++)y[start+i]=(x[start+i]-mean)*inv*w[i]+b[i];
  }return y;
 }
 function attention(x,prefix){
  const qkv=linear(x,N,D,3*D,p[prefix+'self_attn.in_proj_weight'],p[prefix+'self_attn.in_proj_bias']);
  const output=new Float32Array(N*D),scores=new Float32Array(N);
  for(let h=0;h<H;h++)for(let q=0;q<N;q++){
   let max=-Infinity;
   for(let k=0;k<N;k++){
    let s=0;for(let d=0;d<K;d++)s+=qkv[q*3*D+h*K+d]*qkv[k*3*D+D+h*K+d];
    scores[k]=s/Math.sqrt(K);if(scores[k]>max)max=scores[k];
   }
   let total=0;for(let k=0;k<N;k++){scores[k]=Math.exp(scores[k]-max);total+=scores[k];}
   for(let k=0;k<N;k++)scores[k]/=total;
   for(let d=0;d<K;d++){let s=0;for(let k=0;k<N;k++)s+=scores[k]*qkv[k*3*D+2*D+h*K+d];output[q*D+h*K+d]=s;}
  }
  return linear(output,N,D,D,p[prefix+'self_attn.out_proj.weight'],p[prefix+'self_attn.out_proj.bias']);
 }
 function forward(observation){
  if(!observation||observation.length!==315)fail('观察维度必须为315');
  const x=new Float32Array(315);for(let i=0;i<315;i++){if(typeof observation[i]!=='number'||!Number.isFinite(observation[i]))fail('观察包含无效数值');x[i]=observation[i];if(!Number.isFinite(x[i]))fail('观察数值超出范围');}
  const cards=new Float32Array(19*12),res=new Float32Array(6*3),glob=new Float32Array(69);
  cards.set(x.subarray(0,144));
  for(let r=0;r<6;r++){const start=195+Math.floor(r/3)*60+12+(r%3)*15;cards.set(x.subarray(start,start+12),(12+r)*12);res.set(x.subarray(start+12,start+15),r*3);}
  cards.set(x.subarray(176,188),18*12);
  glob.set(x.subarray(144,176));glob.set(x.subarray(188,195),32);
  for(let pl=0;pl<2;pl++){glob.set(x.subarray(195+60*pl,207+60*pl),39+pl*12);glob.set(x.subarray(252+60*pl,255+60*pl),63+pl*3);}
  let tokens=new Float32Array(N*D);
  tokens.set(linear(cards,19,12,D,p['card.weight'],p['card.bias']));
  const rm=linear(res,6,3,D,p['reserve_meta.weight'],null);
  for(let i=0;i<6*D;i++)tokens[12*D+i]+=rm[i];
  tokens.set(linear(glob,1,69,D,p['global_encoder.weight'],p['global_encoder.bias']),19*D);
  for(let r=0;r<N;r++)for(let j=0;j<D;j++)tokens[r*D+j]+=p['roles.weight'][ROLES[r]*D+j];
  for(let l=0;l<4;l++){
   const prefix=`blocks.${l}.`,a=attention(norm(tokens,p[prefix+'norm1.weight'],p[prefix+'norm1.bias']),prefix);
   for(let i=0;i<tokens.length;i++)tokens[i]+=a[i];
   const ff=linear(norm(tokens,p[prefix+'norm2.weight'],p[prefix+'norm2.bias']),N,D,F,p[prefix+'linear1.weight'],p[prefix+'linear1.bias']);
   for(let i=0;i<ff.length;i++)ff[i]=gelu(ff[i]);
   const b=linear(ff,N,F,D,p[prefix+'linear2.weight'],p[prefix+'linear2.bias']);
   for(let i=0;i<tokens.length;i++)tokens[i]+=b[i];
  }
  tokens=norm(tokens,p['norm.weight'],p['norm.bias']);
  const fixed=linear(tokens.subarray(19*D),1,D,56,p['fixed.weight'],p['fixed.bias']);
  const buy=linear(tokens,15,D,1,p['buy.weight'],p['buy.bias']);
  const reserve=linear(tokens,12,D,1,p['reserve.weight'],p['reserve.bias']);
  const logits=new Float32Array(83);
  for(let i=0;i<56;i++)logits[FIXED[i]]=fixed[i];
  for(let i=0;i<12;i++){logits[30+i]=reserve[i];logits[45+i]=buy[i];}
  for(let i=0;i<3;i++)logits[57+i]=buy[12+i];
  if(!logits.every(Number.isFinite))fail('推理产生无效数值');
  return {logits,value:linear(tokens.subarray(19*D),1,D,1,p['value.weight'],p['value.bias'])[0]};
 }
 function choose(observation,mask){
  if(!mask||mask.length!==83)fail('合法掩码维度必须为83');
  const legal=[];for(let i=0;i<83;i++){if(![0,1,false,true].includes(mask[i]))fail('非法掩码值');if(mask[i])legal.push(i);}
  if(!legal.length)fail('没有合法动作');
  const scores=forward(observation).logits;let action=legal[0];for(const i of legal)if(scores[i]>scores[action])action=i;return action;
 }
 return Object.freeze({metadata:Object.freeze(info),forward,logits:obs=>forward(obs).logits,choose});
}
root.SplendorTransformer=Object.freeze({create,sha256});
})(globalThis);
