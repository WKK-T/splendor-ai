"""Batch leaf inference for observation-only, opponent-policy information-set MCTS.

No game object, true shuffle seed or privileged state crosses this interface.
"""
import json
import time
import numpy as np
import torch


class Evaluator:
    def __init__(self, net, kind, static_data, device='cuda', max_batch=256):
        assert kind in ('legacy', 'structured')
        self.net, self.kind, self.static_data = net, kind, static_data
        self.device = torch.device(device)
        self.max_batch = max_batch
        self.calls = self.positions = 0
        self.seconds = 0.
        self.raw_value_min = float("inf")
        self.raw_value_max = float("-inf")
        self.value_clips = 0

    @torch.no_grad()
    def predict(self, encoded315, legal_masks, observations):
        start = time.perf_counter()
        masks = np.asarray(legal_masks, dtype=bool)
        assert len(masks) and masks.shape[1] == 83 and masks.any(1).all()
        was_training = self.net.training
        self.net.eval()
        pp, vv = [], []
        try:
            for i in range(0, len(masks), self.max_batch):
                m = torch.as_tensor(masks[i:i+self.max_batch], device=self.device)
                if self.kind == 'legacy':
                    x = torch.as_tensor(np.asarray(encoded315[i:i+self.max_batch], dtype=np.float32), device=self.device)
                    logits, v = self.net(x, m)
                else:
                    from .model import encode_observations, tensor_batch
                    features = encode_observations(observations[i:i+self.max_batch], self.static_data)
                    x = tensor_batch(features, self.device, masks[i:i+self.max_batch])
                    logits, v = self.net(x)
                logits = logits.masked_fill(~m, -1e9)
                p = logits.float().softmax(-1)
                assert torch.isfinite(p).all() and torch.isfinite(v).all()
                self.raw_value_min = min(self.raw_value_min, float(v.min()))
                self.raw_value_max = max(self.raw_value_max, float(v.max()))
                self.value_clips += int(((v < -1) | (v > 1)).sum())
                pp.append(p.cpu().numpy())
                vv.append(v.float().clamp(-1, 1).cpu().numpy())
        finally:
            self.net.train(was_training)
        self.calls += 1
        self.positions += len(masks)
        self.seconds += time.perf_counter() - start
        return np.concatenate(pp), np.concatenate(vv)


def batch_search(evaluator, observations, simulations, seeds, cpuct=1.5,
                 max_decisions=128, root_noise=False, noise_fraction=.25,
                 noise_alpha=.3, opponent_evaluator=None, cancelled=None):
    """Return per-root dict with policy, visits, q, root_value and counters.

Search rng and root-noise rng are local and do not consume training torch RNG.
Engine results are visit targets (temperature1). The caller chooses actual moves.
"""
    from . import splendor_pv_noble_search as engine
    assert len(observations) == len(seeds) and len(observations)
    texts = [x if isinstance(x, str) else json.dumps(x, separators=(',', ':')) for x in observations]
    searches = [engine.Search(s, int(simulations), int(seed), float(cpuct), int(max_decisions))
                for s, seed in zip(texts, seeds)]
    noise_rngs = [np.random.default_rng(int(s) ^ 0x5AF13D21) for s in seeds]
    start = time.perf_counter()
    evaluators = [evaluator] + ([opponent_evaluator] if opponent_evaluator is not None and opponent_evaluator is not evaluator else [])
    before_positions = sum(e.positions for e in evaluators)
    before_seconds = sum(e.seconds for e in evaluators)
    calls = 0
    while True:
        if cancelled is not None and cancelled():
            raise InterruptedError('search cancelled')
        requests, owners = [], []
        for i, search in enumerate(searches):
            if not search.done():
                reqs = search.requests()
                assert len(reqs) == 1, 'noncomplete engine must request one observation'
                requests.append(reqs[0]); owners.append(i)
        if not requests:
            break
        p=np.zeros((len(requests),83),np.float32);v=np.zeros(len(requests),np.float32)
        for use_opponent in (False,True):
            inds=[j for j,r in enumerate(requests) if (opponent_evaluator is not None and r[1]=='opponent')==use_opponent]
            if not inds:continue
            ev=opponent_evaluator if use_opponent else evaluator
            probs,values=ev.predict([requests[j][2] for j in inds],[requests[j][3] for j in inds],[requests[j][4] for j in inds])
            p[inds],v[inds]=probs,values
        for j, i in enumerate(owners):
            request_id, kind, _, mask, _ = requests[j]
            prior = p[j]
            if root_noise and kind == 'root':
                legal = np.flatnonzero(mask)
                noise = noise_rngs[i].dirichlet(np.full(len(legal), noise_alpha))
                prior = prior.copy()
                prior[legal] = (1-noise_fraction)*prior[legal] + noise_fraction*noise
            searches[i].submit(int(request_id), prior.astype(float).tolist(), float(v[j]))
        calls += 1
        assert calls < (int(simulations)+2)*(int(max_decisions)*16+100), 'search request safety bound'
    elapsed = time.perf_counter() - start
    result = [json.loads(s.result_json()) for s in searches]
    for row in result:
        row['batch_wall_seconds'] = elapsed
        row['batch_network_positions'] = sum(e.positions for e in evaluators)-before_positions
        row['batch_network_seconds'] = sum(e.seconds for e in evaluators)-before_seconds
        row['batch_roots'] = len(result)
    return result
