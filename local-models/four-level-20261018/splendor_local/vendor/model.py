"""Information-safe structured policy/WDL network for neural MCTS.

Only filtered ``Game.observation_json()`` may enter this encoder. No game state,
deck order, sampled future, search value or eventual outcome is an input.
33 unordered object tokens: 12 market, 6 reserve, 2 players, 10 nobles, bank,
pending purchase and context. Market tokens have tier but no slot embedding.
Public owned-card identities are explicit 90-bit features on player tokens.

WDL order is LOSS=0, DRAW=1, WIN=2, from the observation's acting player.
"""
from __future__ import annotations

import copy
import itertools
import json
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import torch
from torch import nn

ENCODER_VERSION = 2
NUM_ACTIONS = 83
NUM_TOKENS = 33
TOKEN_FEATURES = 128
ACTION_FEATURES = 24
LOSS, DRAW, WIN = 0, 1, 2
DEFAULT_CONFIG = dict(width=256, depth=8, heads=8, ff=1024, dropout=0.0)


@dataclass(frozen=True)
class StaticTables:
    cards: tuple
    noble_requirements: np.ndarray
    noble_points: np.ndarray


def prepare_static_data(static_data):
    """Prepare once and reuse; accepts JSON, decoded definitions or this object."""
    if isinstance(static_data, StaticTables):
        return static_data
    if isinstance(static_data, str):
        return _parse_static_json(static_data)
    cards, nobles = static_data['cards'], static_data['nobles']
    if len(cards) != 90 or len(nobles) != 10:
        raise ValueError('Expected original-game definitions: 90 cards / 10 nobles')
    return StaticTables(tuple(cards), np.asarray([n['req'] for n in nobles], dtype=np.float32),
                        np.asarray([n['points'] for n in nobles], dtype=np.float32))


@lru_cache(maxsize=4)
def _parse_static_json(data):
    return prepare_static_data(json.loads(data))


def _noble_stats(bonus, available, tables):
    if not len(available):
        return 0., 0., 0.
    gaps = np.maximum(tables.noble_requirements[available] - bonus, 0).sum(-1)
    qualifying = gaps == 0
    # At most one noble is earned per turn, never sum all qualifying points.
    gain = float(tables.noble_points[available][qualifying].max()) if qualifying.any() else 0.
    return float(qualifying.sum()), float(gaps.min()), gain


def _card_features(card_id, players, available, tables, *, present, tier, public,
                   owner, accessible):
    f = np.zeros(TOKEN_FEATURES, np.float32)
    f[0], f[1], f[2], f[14], f[15] = present, card_id is not None, tier / 3., public, owner
    if card_id is None:
        return f
    card = tables.cards[int(card_id)]
    f[2], f[3], f[4 + int(card['bonus'])] = card['tier'] / 3., card['points'] / 5., 1.
    f[9:14] = np.asarray(card['cost']) / 7.
    f[16:18] = accessible
    for pi, p in enumerate(players):
        bonus, gems = np.asarray(p['bonuses']), np.asarray(p['tokens'])
        discounted = np.maximum(np.asarray(card['cost']) - bonus, 0)
        missing = np.maximum(discounted - gems[:5], 0)
        next_bonus = bonus.copy(); next_bonus[int(card['bonus'])] += 1
        n0, gap0, _ = _noble_stats(bonus, available, tables)
        n1, gap1, noble_gain = _noble_stats(next_bonus, available, tables)
        base = 20 + pi * 20
        f[base:base+5] = discounted / 7.
        f[base+5:base+10] = missing / 7.
        f[base+10] = missing.sum() / 10.
        f[base+11] = float(missing.sum() <= gems[5] and accessible[pi])
        f[base+12:base+16] = [n0 / 3., gap0 / 12., n1 / 3., gap1 / 12.]
        f[base+16:base+20] = [noble_gain / 3., (p['points'] + card['points'] + noble_gain) / 20.,
                                    (len(p['owned']) + 1) / 20.,
                                    float(accessible[pi] and p['points'] + card['points'] + noble_gain >= 15)]
    # Potential score/15 are descriptive, not a claimed terminal win or safe defense.
    return f


def _action_layout():
    target = np.full(NUM_ACTIONS, 32, np.int64)
    features = np.zeros((NUM_ACTIONS, ACTION_FEATURES), np.float32)
    distinct = [(i,) for i in range(5)] + list(itertools.combinations(range(5), 2)) + list(itertools.combinations(range(5), 3))
    for i, colors in enumerate(distinct):
        features[i, 0] = 1.; features[i, 10 + np.asarray(colors)] = 1. / 3.
    for color in range(5):
        features[25+color, 1] = 1.; features[25+color, 10+color] = 2. / 3.
    for slot in range(12):
        target[30+slot] = target[45+slot] = slot
        features[30+slot, 2] = 1.; features[45+slot, 4] = 1.
    for tier in range(3):
        features[42+tier, 3] = 1.; features[42+tier, 16+tier] = 1.
        target[57+tier] = 12+tier; features[57+tier, 5] = 1.
    for color in range(6):
        target[60+color] = target[77+color] = 18
        features[60+color, 6] = 1.; features[60+color, 10+color] = -1. / 3.
        features[77+color, 9] = 1.; features[77+color, 10+color] = -1. / 3.
    for noble in range(10):
        target[66+noble] = 20+noble; features[66+noble, 7] = 1.
    features[76, 8] = 1.
    return target, features


_ACTION_TOKENS, _ACTION_FEATURES = _action_layout()
_ROLES = np.asarray([0]*4 + [1]*4 + [2]*4 + [3]*3 + [4]*3 + [5, 6] + [7]*10 + [8, 9, 10], np.int64)


def _encode_base_layout(observations, static_data):
    """Return NumPy inputs from acting-player FILTERED observations only.

    Opponent nonpublic reserve identities are scrubbed defensively even if an
    upstream caller mistakenly inserts them. Privileged states are rejected.
    Legal masks must come separately from the engine (or search's legal list).
    """
    tables = prepare_static_data(static_data)
    batch = len(observations)
    tokens = np.zeros((batch, NUM_TOKENS, TOKEN_FEATURES), np.float32)
    padding = np.zeros((batch, NUM_TOKENS), bool)
    for bi, raw in enumerate(observations):
        obs = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(obs, dict) or 'viewer' not in obs or 'decks' in obs:
            raise ValueError('Only filtered observation JSON is accepted; privileged states forbidden')
        if obs['viewer'] != obs['current']:
            raise ValueError('Network perspective must be the acting player')
        if len(obs['players']) != 2:
            raise ValueError('This frozen experiment implements two-player games only')
        current = int(obs['current'])
        players = [obs['players'][current], obs['players'][1-current]]
        available = np.asarray(obs['nobles'], np.int64)
        for tier, row in enumerate(obs['display']):
            for slot, cid in enumerate(row):
                ti = 4*tier+slot
                tokens[bi, ti] = _card_features(cid, players, available, tables, present=cid is not None,
                                               tier=tier+1, public=True, owner=0., accessible=(True, True))
                padding[bi, ti] = cid is None
        for pi, p in enumerate(players):
            for slot in range(3):
                ti = 12 + 3*pi + slot
                exists = slot < len(p['reserved'])
                public = bool(p['reserved_public'][slot]) if exists else False
                cid = p['reserved'][slot] if exists and (pi == 0 or public) else None
                tier = p['reserved_tiers'][slot] if exists else 0
                tokens[bi, ti] = _card_features(cid, players, available, tables, present=exists, tier=tier,
                                               public=public, owner=1. if pi == 0 else -1.,
                                               accessible=(pi == 0, pi == 1))
                padding[bi, ti] = not exists
            pf = tokens[bi, 18+pi]
            pf[:6] = np.asarray(p['tokens']) / 10.
            pf[6:11] = np.asarray(p['bonuses']) / 7.
            pf[11:16] = [p['points']/15., len(p['owned'])/20., len(p['nobles'])/5.,
                         len(p['reserved'])/3., p['seat']/3.]
            for cid in p['owned']: pf[16 + int(cid)] = 1.
            for nid in p['nobles']: pf[106 + int(nid)] = 1.
            count, gap, gain = _noble_stats(np.asarray(p['bonuses']), available, tables)
            pf[116:120] = [gap/12., count/3., gain/3., float(p['points'] >= 15)]
        for nid in range(10):
            nf = tokens[bi, 20+nid]
            nf[0] = nid in obs['nobles']; nf[1] = nid in players[0]['nobles']; nf[2] = nid in players[1]['nobles']
            nf[3] = tables.noble_points[nid] / 3.; nf[4:9] = tables.noble_requirements[nid] / 4.
            for pi, p in enumerate(players):
                gap = np.maximum(tables.noble_requirements[nid] - np.asarray(p['bonuses']), 0)
                nf[10+8*pi:15+8*pi] = gap / 4.
                nf[15+8*pi:18+8*pi] = [gap.sum()/12., float(gap.sum() == 0), (p['points']+tables.noble_points[nid])/20.]
            # Unselected nobles are absent objects; IDs and static definitions stay public.
            padding[bi, 20+nid] = not bool(nf[:3].any())
        tokens[bi, 30, :6] = np.asarray(obs['bank']) / 7.
        tokens[bi, 30, 6:9] = np.asarray(obs['deck_sizes']) / np.asarray([40., 30., 20.])
        pending = obs.get('pending_purchase')
        if pending:
            cid = pending['card_id']
            tokens[bi, 31] = _card_features(cid, players, available, tables, present=True,
                                           tier=tables.cards[cid]['tier'], public=True, owner=1., accessible=(True, False))
            tokens[bi, 31, 60:65] = np.asarray(pending['remaining_cost']) / 7.
            source = pending['source']
            tokens[bi, 31, 65:67] = ['Display' in source, 'Reserved' in source]
        else:
            padding[bi, 31] = True
        cf = tokens[bi, 32]
        phases = ['Play', 'Discard', 'ChooseNoble', 'PayCard', 'GameOver']
        cf[phases.index(obs['phase'])] = 1.
        cf[5:13] = [obs['round']/60., float(obs['final_round_triggered']), obs['turns_until_round_end']/2.,
                     current/3., obs['starting_player']/3., float(current == obs['starting_player']),
                     (players[0]['points']-players[1]['points'])/15.,
                     (len(players[0]['owned'])-len(players[1]['owned']))/20.]
        cf[13:18] = np.asarray(pending['remaining_cost'])/7. if pending else 0.
    return {'tokens': tokens, 'padding_mask': padding,
            'roles': np.broadcast_to(_ROLES, (batch, NUM_TOKENS)).copy(),
            'action_tokens': np.broadcast_to(_ACTION_TOKENS, (batch, NUM_ACTIONS)).copy(),
            'action_features': np.broadcast_to(_ACTION_FEATURES, (batch, NUM_ACTIONS, ACTION_FEATURES)).copy()}


def tensor_batch(inputs, device='cpu', legal_masks=None):
    batch = {k: torch.as_tensor(v, device=device) for k, v in inputs.items()}
    if legal_masks is not None:
        batch['mask'] = torch.as_tensor(legal_masks, dtype=torch.bool, device=device)
    return batch


class StructuredTransformer(nn.Module):
    """Shared candidate scorer; no market-slot, reserve-slot or card-ID embedding."""
    def __init__(self, config=None):
        super().__init__()
        self.config = {**DEFAULT_CONFIG, **(config or {})}
        d, depth, heads, ff = (int(self.config[k]) for k in ('width', 'depth', 'heads', 'ff'))
        if d % heads or depth < 1:
            raise ValueError('width must divide heads and depth must be positive')
        self.input_encoder = nn.Linear(TOKEN_FEATURES, d)
        self.roles = nn.Embedding(11, d)
        self.blocks = nn.ModuleList([nn.TransformerEncoderLayer(d, heads, ff, dropout=float(self.config['dropout']),
                                      activation='gelu', batch_first=True, norm_first=True) for _ in range(depth)])
        # Explicit independent initialization, including packed attention projections.
        for block in self.blocks:
            for p in block.parameters():
                if p.ndim > 1: nn.init.xavier_uniform_(p)
        self.norm = nn.LayerNorm(d)
        self.action_encoder = nn.Linear(ACTION_FEATURES, d)
        self.policy_head = nn.Sequential(nn.Linear(3*d, d//2), nn.GELU(), nn.Linear(d//2, 1))
        self.wdl_head = nn.Sequential(nn.Linear(d, d//2), nn.GELU(), nn.Linear(d//2, 3))

    def forward_outputs(self, batch, mask=None):
        x = self.input_encoder(batch['tokens']) + self.roles(batch['roles'])
        padding = batch['padding_mask'].bool()
        for block in self.blocks:
            x = block(x, src_key_padding_mask=padding)
        x = self.norm(x)
        context = x[:, -1]
        indices = batch['action_tokens'].long().unsqueeze(-1).expand(-1, -1, x.shape[-1])
        target = torch.gather(x, 1, indices)
        action = self.action_encoder(batch['action_features'])
        features = torch.cat([context[:, None].expand(-1, NUM_ACTIONS, -1), target, action], -1)
        logits = self.policy_head(features).squeeze(-1)
        mask = batch.get('mask') if mask is None else mask
        if mask is not None:
            logits = logits.masked_fill(~mask.bool(), -1e9)
        wdl_logits = self.wdl_head(context)
        wdl = wdl_logits.softmax(-1)
        return {'logits': logits, 'wdl_logits': wdl_logits, 'value': wdl[:, WIN]-wdl[:, LOSS]}

    def forward(self, batch, mask=None):
        out = self.forward_outputs(batch, mask)
        return out['logits'], out['value']

    def parameter_count(self):
        return sum(p.numel() for p in self.parameters())


def permute_market_observation(observation, slots):
    """Test/augmentation helper. new_slot i gets old_slot slots[i]."""
    obs = json.loads(observation) if isinstance(observation, str) else copy.deepcopy(observation)
    slots = np.asarray(slots, np.int64)
    if sorted(slots.tolist()) != list(range(12)) or not np.array_equal(slots//4, np.arange(12)//4):
        raise ValueError('Permutation must stay within market tiers')
    flat = sum(obs['display'], [])
    obs['display'] = [[flat[int(slots[4*t+s])] for s in range(4)] for t in range(3)]
    pending = obs.get('pending_purchase')
    if pending and 'Display' in pending['source']:
        src = pending['source']['Display']; old = 4*src['tier']+src['slot']
        src['slot'] = int(np.flatnonzero(slots == old)[0] % 4)
    actions = np.arange(NUM_ACTIONS)
    actions[30:42], actions[45:57] = 30+slots, 45+slots
    return obs, actions


def noble_basis(points, req):
    req=np.asarray(req,dtype=np.float64)/4.
    return np.r_[float(points)/3.,req,[req[i]*req[j] for i in range(5) for j in range(i+1,5)]]

@lru_cache(maxsize=1)
def ownership_interpolator():
    from . import splendor_pv_noble_search as E
    base=json.loads(E.static_data_json())['nobles']
    phi=np.stack([noble_basis(n['points'],n['req']) for n in base])
    assert np.linalg.matrix_rank(phi)==10
    inv=np.linalg.pinv(phi)
    assert np.max(np.abs(phi@inv-np.eye(10)))<1e-10
    return inv

def encode_observations(observations, static_data):
    """Attribute-only public tile adapter; no gradient updates or noble-ID features.

    Noble IDs are used solely to look up public attributes. On the original ten
    tiles, quadratic interpolation reconstructs the learned ownership channels.
    Extra tiles use an untrained attribute interpolation, not a claimed learned
    representation. All 33 tokens and all learned parameter tensors are retained.
    """
    static=json.loads(static_data) if isinstance(static_data,str) else static_data
    inv=ownership_interpolator(); rows=[]
    for raw in observations:
        obs=json.loads(raw) if isinstance(raw,str) else copy.deepcopy(raw)
        if 'decks' in obs or obs.get('viewer')!=obs.get('current'):
            raise ValueError('Only acting-player filtered observations allowed')
        if obs.get('ruleset_version')!='splendor-pv-attribute-nobles-v1':
            raise ValueError('Attribute nobles observation version required')
        catalog=obs['noble_catalog']
        ids=list(obs['nobles'])+sum([p['nobles'] for p in obs['players']],[])
        if len(ids)!=3 or len(set(ids))!=3 or any(i<0 or i>=len(catalog) for i in ids):
            raise ValueError('Two-player game must conserve three noble tiles')
        # Packing is by public list/ownership, never catalog identity. Attention
        # is permutation equivariant; action pointers follow the visible slots.
        remap={old:i for i,old in enumerate(ids)}
        local=copy.deepcopy(obs);local['nobles']=[remap[i] for i in obs['nobles']]
        for p in local['players']:p['nobles']=[remap[i] for i in p['nobles']]
        tiles=[catalog[i] for i in ids]+[{'points':0,'req':[0]*5} for _ in range(7)]
        f=_encode_base_layout([local],dict(cards=static['cards'],nobles=tiles))
        for pi,p in enumerate([obs['players'][obs['current']],obs['players'][1-obs['current']]]):
            z=np.zeros(10,dtype=np.float64)
            for nid in p['nobles']:
                n=catalog[nid];z+=noble_basis(n['points'],n['req'])@inv
            f['tokens'][0,18+pi,106:116]=z.astype(np.float32)
        # Only 66..68 can be legal in this two-player API. Remaining slots are
        # reserved and stay masked; each noble action points at its actual tile.
        rows.append(f)
    return {k:np.concatenate([r[k] for r in rows],axis=0) for k in rows[0]}
