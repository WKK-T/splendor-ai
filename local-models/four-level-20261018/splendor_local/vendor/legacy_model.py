"""Schema-v2 models. Display cards have tier, but no within-tier position embedding."""
import torch
from torch import nn


class CardTransformer(nn.Module):
    def __init__(self):
        super().__init__(); d=160
        self.card=nn.Linear(12,d); self.reserve_meta=nn.Linear(3,d,bias=False)
        self.global_encoder=nn.Linear(69,d); self.roles=nn.Embedding(7,d)
        layer=nn.TransformerEncoderLayer(d,8,640,dropout=0.,activation='gelu',batch_first=True,norm_first=True)
        self.blocks=nn.ModuleList([__import__('copy').deepcopy(layer) for _ in range(4)])
        # Independent initialization: TransformerEncoder clones otherwise start identically.
        for block in self.blocks:
            for p in block.parameters():
                if p.ndim>1: nn.init.xavier_uniform_(p)
        self.norm=nn.LayerNorm(d); self.fixed=nn.Linear(d,56)
        self.buy=nn.Linear(d,1); self.reserve=nn.Linear(d,1); self.value=nn.Linear(d,1)
        nn.init.zeros_(self.value.weight); nn.init.zeros_(self.value.bias)
        self.register_buffer('fixed_ids',torch.tensor(list(range(30))+list(range(42,45))+list(range(60,83))))
        self.register_buffer('role_ids',torch.tensor([0]*4+[1]*4+[2]*4+[3]*3+[4]*3+[5,6]))
    def forward(self,x,mask):
        b=len(x); players=x[:,195:].reshape(b,2,60)
        res=players[:,:,12:57].reshape(b,6,15)
        glob=torch.cat([x[:,144:176],x[:,188:195],players[:,:,:12].reshape(b,24),players[:,:,57:].reshape(b,6)],-1)
        tokens=torch.cat([self.card(x[:,:144].reshape(b,12,12)),
                          self.card(res[:,:,:12])+self.reserve_meta(res[:,:,12:]),
                          self.card(x[:,176:188]).unsqueeze(1),self.global_encoder(glob).unsqueeze(1)],1)
        tokens=tokens+self.roles(self.role_ids)[None]
        for block in self.blocks: tokens=block(tokens)
        tokens=self.norm(tokens); z=tokens[:,-1]
        logits=x.new_zeros((b,83)); logits[:,self.fixed_ids]=self.fixed(z)
        logits[:,30:42]=self.reserve(tokens[:,:12]).squeeze(-1)
        logits[:,45:57]=self.buy(tokens[:,:12]).squeeze(-1)
        logits[:,57:60]=self.buy(tokens[:,12:15]).squeeze(-1)
        return logits.masked_fill(~mask,-1e9),self.value(z).squeeze(-1)
