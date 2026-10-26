"""Lazy verified weights, shared PV models, and observation-only inference."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import threading
import time

import numpy as np
import torch

from . import observation as obs
from .vendor.model import StructuredTransformer
from .vendor.noble_model import migrate
from .vendor.search import Evaluator, batch_search

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def manifest():
    return json.loads((ROOT/'manifest.json').read_text())


def verify_package():
    m = manifest()
    checked = []
    for entry in [*m['models'].values(), *({'path': k, **v} for k, v in m['vendor_files'].items())]:
        path = ROOT/entry['path']
        actual = sha256(path)
        if actual != entry['sha256']:
            raise ValueError(f"SHA-256 mismatch: {entry['path']}")
        checked.append({'path': entry['path'], 'sha256': actual})
    return {'passed': True, 'files': checked, 'downloads': 0}


class Dual(torch.nn.Module):
    """Policy and independently trained, calibrated WDL value network."""
    def __init__(self, policy, value, temperature):
        super().__init__()
        self.policy, self.value = policy, value
        self.temperature = float(temperature)

    def forward(self, batch):
        logits = self.policy(batch)[0]
        wdl = (self.value.forward_outputs(batch)['wdl_logits']/self.temperature).softmax(-1)
        return logits, wdl[:, 2]-wdl[:, 0]


class Runtime:
    """One persistent runtime per local process; infer calls are serialized.

    hard and hell reuse the identical PV422 evaluator and independent value
    network. medium and the search opponent reuse the same migrated 200M.
    The seed controls hypothetical search sampling, never the true deck.
    """
    def __init__(self, device='cpu', threads=1):
        self.manifest = manifest()
        if device != 'cpu':
            raise ValueError('This local acceptance package currently supports validated CPU inference only')
        if type(threads) is not int or not 1 <= threads <= 32:
            raise ValueError('threads must be an integer in 1..32')
        torch.set_num_threads(threads)
        self.device = device
        self._evaluators = {}
        self._lock = threading.RLock()

    def evaluator(self, model):
        with self._lock:
            if model in self._evaluators:
                return self._evaluators[model]
            if model not in self.manifest['models']:
                raise ValueError(f'unknown model: {model}')
            entry = self.manifest['models'][model]
            path = ROOT/entry['path']
            if sha256(path) != entry['sha256']:
                raise ValueError(f'weight integrity check failed: {model}')
            c = torch.load(path, map_location='cpu', weights_only=True)
            # Module construction initializes tensors before frozen weights are
            # installed. Isolate that initialization from the caller's RNG.
            with torch.random.fork_rng(devices=[]):
                torch.manual_seed(0)
                if model.startswith('PV'):
                    policy = StructuredTransformer(c['model_config'])
                    value = StructuredTransformer(c['model_config'])
                    policy.load_state_dict(c['policy'], strict=True)
                    value.load_state_dict(c['state_dict'], strict=True)
                    if c['temperature'] != entry['value_temperature']:
                        raise ValueError('value calibration differs from manifest')
                    net = Dual(policy, value, c['temperature'])
                    kind = 'structured'
                else:
                    net = migrate(c['state_dict'])
                    kind = 'legacy'
            net.to(self.device).eval().requires_grad_(False)
            ev = Evaluator(net, kind, obs.engine.static_data_json(), self.device)
            self._evaluators[model] = ev
            return ev

    def loaded_models(self):
        with self._lock:
            return list(self._evaluators)

    def infer(self, observation, profile='medium', *, seed=0, noble_external_ids=None, legal_mask=None, cancelled=None):
        with self._lock:
            if cancelled is not None and cancelled():
                raise InterruptedError('inference cancelled')
            started = time.perf_counter()
            if profile not in self.manifest['profiles']:
                raise ValueError(f'unknown profile: {profile}')
            obs.integer(seed, 0, 2**64-1, 'search seed')
            spec = self.manifest['profiles'][profile]
            o = obs.validate(observation)
            ids = obs.external_ids(noble_external_ids, o['noble_catalog'])
            terminal = o['phase'] == 'GameOver'
            search = None
            encoded = None
            if terminal:
                mask = [False]*83
            else:
                # The frozen native planner reconstructs hypothetical hidden
                # worlds from public facts; no true shuffle is accepted.
                search = obs.engine.Search(json.dumps(o), max(128, spec['simulations']), seed, 1.5, 128)
                if search.done():
                    forced = json.loads(search.result_json())
                    mask = [p > 0 for p in forced['policy']]
                else:
                    _, kind, encoded, mask, reconstructed = search.requests()[0]
                    if kind != 'root' or json.loads(reconstructed) != o:
                        raise RuntimeError('native observation reconstruction mismatch')
            if legal_mask is not None:
                obs.require(type(legal_mask) is list and len(legal_mask) == 83
                            and all(type(x) is bool for x in legal_mask), 'legal_mask must be 83 booleans')
                obs.require(legal_mask == mask, 'caller legal mask differs from native rules')
            result = {'profile': profile, 'model': spec['model'], 'action_version': obs.ACTION_VERSION,
                      'observation_sha256': obs.fingerprint(o), 'search_seed': seed,
                      'phase': o['phase'], 'legal_mask': mask, 'action_index': None, 'action': None,
                      'policy': [0.0]*83, 'value': None, 'search': None,
                      'requested_simulations': spec['simulations'], 'simulations': 0,
                      'terminal': terminal, 'forced': False}
            legal = np.flatnonzero(mask)
            if terminal:
                ranks = [(p['points'], -len(p['owned'])) for p in o['players']]
                best = max(ranks)
                result['winners'] = [i for i, rank in enumerate(ranks) if rank == best]
            elif len(legal) == 1:
                result['forced'] = True
                result['policy'][int(legal[0])] = 1.0
            else:
                ev = self.evaluator(spec['model'])
                if not spec['simulations']:
                    p, v = ev.predict([encoded], [mask], [o])
                    result['policy'] = p[0].astype(float).tolist()
                    result['value'] = float(v[0])
                else:
                    r = batch_search(ev, [o], spec['simulations'], [seed], cpuct=1.5,
                                     max_decisions=128, root_noise=False,
                                     opponent_evaluator=self.evaluator('s422-200M'),cancelled=cancelled)[0]
                    result.update(policy=r['policy'], value=r['root_value'], search=r, simulations=r['simulations'])
            if not terminal:
                probabilities = np.asarray(result['policy'])
                if not np.isfinite(probabilities).all() or any(p and not mask[i] for i, p in enumerate(probabilities)):
                    raise RuntimeError('nonfinite or illegal model policy')
                if abs(float(probabilities.sum())-1) > 2e-6:
                    raise RuntimeError('model policy is not normalized')
                action = int(probabilities.argmax())
                result.update(action_index=action, action=obs.describe_action(action, o, ids))
            result['wall_seconds'] = time.perf_counter()-started
            if cancelled is not None and cancelled():
                raise InterruptedError('inference cancelled')
            return result
