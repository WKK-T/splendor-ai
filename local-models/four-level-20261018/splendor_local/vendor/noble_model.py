"""Attribute-based nobles, with function-preserving initialization on base tiles.

No noble identity is read by this model. Shared degree-two attribute features
replace both the global presence contribution and the noble choice classifier.
The card encoder, four Transformer blocks and other heads retain parent weights.
"""
import copy,json
import torch
from torch import nn
from .legacy_model import CardTransformer

def basis(n):
    # n = [presence, points/3, white/4, blue/4, green/4, red/4, black/4]
    req=n[...,2:];pairs=torch.stack([req[...,i]*req[...,j] for i in range(5) for j in range(i+1,5)],-1)
    return torch.cat([n[...,1:2],req,pairs],-1)*n[...,:1]

class NobleTransformer(nn.Module):
    def __init__(self):
        super().__init__();self.backbone=CardTransformer()
        self.noble_global=nn.Linear(16,160,bias=False)
        self.noble_choice=nn.Linear(16,161,bias=False)
        keep=[i for i,a in enumerate(self.backbone.fixed_ids.tolist()) if not 66<=a<76]
        old=self.backbone.fixed
        self.backbone.fixed=nn.Linear(160,len(keep))
        self.backbone.fixed_ids=self.backbone.fixed_ids[keep]
        # Remove old identity input columns physically, not merely mask them.
        self.backbone.global_encoder=nn.Linear(59,160)
    def forward(self,x,mask):
        b=len(x);old=x[:,:315];p=old[:,195:].reshape(b,2,60);res=p[:,:,12:57].reshape(b,6,15)
        glob=torch.cat([old[:,144:153],old[:,163:176],old[:,188:195],p[:,:,:12].reshape(b,24),p[:,:,57:].reshape(b,6)],-1)
        f=basis(x[:,315:].reshape(b,5,7));net=self.backbone
        tokens=torch.cat([net.card(old[:,:144].reshape(b,12,12)),net.card(res[:,:,:12])+net.reserve_meta(res[:,:,12:]),
            net.card(old[:,176:188]).unsqueeze(1),(net.global_encoder(glob)+self.noble_global(f).sum(1)).unsqueeze(1)],1)
        tokens=tokens+net.roles(net.role_ids)[None]
        for block in net.blocks:tokens=block(tokens)
        tokens=net.norm(tokens);z=tokens[:,-1]
        logits=x.new_zeros((b,83));logits[:,net.fixed_ids]=net.fixed(z)
        logits[:,30:42]=net.reserve(tokens[:,:12]).squeeze(-1)
        logits[:,45:57]=net.buy(tokens[:,:12]).squeeze(-1)
        logits[:,57:60]=net.buy(tokens[:,12:15]).squeeze(-1)
        w=self.noble_choice(f);logits[:,66:71]=(w[:,:,:160]*z[:,None]).sum(-1)+w[:,:,160]
        return logits.masked_fill(~mask,-1e9),net.value(z).squeeze(-1)

def migrate(state):
    from . import splendor_pv_noble_search as E
    old=CardTransformer();old.load_state_dict(state);net=NobleTransformer()
    names=['card','reserve_meta','roles','blocks','norm','buy','reserve','value']
    for name in names:setattr(net.backbone,name,copy.deepcopy(getattr(old,name)))
    keep=[i for i,a in enumerate(old.fixed_ids.tolist()) if not 66<=a<76]
    choose=[old.fixed_ids.tolist().index(a) for a in range(66,76)]
    tiles=json.loads(E.static_data_json())['nobles'];n=torch.tensor([[1.,t['points']/3,*[r/4 for r in t['req']]] for t in tiles],dtype=torch.float64)
    phi=basis(n);assert torch.linalg.matrix_rank(phi)==10
    inverse=torch.linalg.pinv(phi.T)
    with torch.no_grad():
        net.backbone.global_encoder.weight.copy_(torch.cat([old.global_encoder.weight[:,:9],old.global_encoder.weight[:,19:]],1))
        net.backbone.global_encoder.bias.copy_(old.global_encoder.bias)
        net.backbone.fixed.weight.copy_(old.fixed.weight[keep]);net.backbone.fixed.bias.copy_(old.fixed.bias[keep])
        net.noble_global.weight.copy_((old.global_encoder.weight[:,9:19].double()@inverse).float())
        target=torch.cat([old.fixed.weight[choose],old.fixed.bias[choose,None]],1)
        net.noble_choice.weight.copy_((target.T.double()@inverse).float())
    return net
