"""Small deterministic acceptance checks; no training or strength evaluation."""
import copy
import itertools
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest

import numpy as np
import torch

from splendor_local import Runtime, LocalSession, ObservationError, verify_package
from splendor_local.inference import ROOT, Dual, sha256
from splendor_local.observation import CARDS, STATIC, engine as E, validate, describe_action
from splendor_local.vendor import original_model as OM
from splendor_local.vendor.legacy_model import CardTransformer

METRICS = {}


def observation(game):
    return json.loads(game.observation_json())


def replay(extra):
    g = E.Game(9917000000000000, extra)
    states, actions = [], []
    while not g.done() and len(actions) < 500:
        states.append(g.clone())
        a = g.greedy_index()
        assert g.mask()[a]
        actions.append(a)
        g.step(a)
    assert g.done()
    check = E.Game(9917000000000000, extra)
    for a in actions:
        check.step(a)
    assert check.state_json() == g.state_json()
    return states, g, actions


def choose_owned(counts, target):
    # Synthetic rule fixtures contain real card identities and exact points.
    ways = {0: []}
    for color, count in enumerate(counts):
        combinations = {}
        ids = [c['id'] for c in CARDS if c['bonus'] == color]
        for subset in itertools.combinations(ids, count):
            points = sum(CARDS[x]['points'] for x in subset)
            combinations.setdefault(points, list(subset))
        ways = {s+p: prev+cards for s, prev in ways.items() for p, cards in combinations.items() if s+p <= target}
    return ways[target]


def noble_fixture(req, points=3, seat=1, base=False):
    state = json.loads(E.Game(7).state_json())
    state['noble_catalog'] = ([{'points': n['points'], 'req': n['req']} for n in STATIC['nobles']] if base else
                              [{'points': points, 'req': req}, {'points': 2, 'req': [0]*5}, {'points': 3, 'req': [20]*5}])
    state['nobles'] = [0, 1, 2]
    state['phase'] = 'ChooseNoble'
    state['current'] = seat
    player = state['players'][seat]
    player['owned'] = choose_owned(req, 15-points)
    player['bonuses'] = req
    player['points'] = sum(CARDS[c]['points'] for c in player['owned'])
    used = set(player['owned'])
    for tier in range(3):
        rest = [c['id'] for c in CARDS if c['tier'] == tier+1 and c['id'] not in used]
        state['display'][tier] = rest[:4]
        state['decks'][tier] = rest[4:]
    return E.Game.from_state_json(json.dumps(state), 0)


def native_root(o):
    s = E.Search(json.dumps(o), 128, 0, 1.5, 128)
    assert not s.done()
    return s.requests()[0]


def payment_fixture():
    s=json.loads(E.Game(7,True).state_json())
    cid=s['display'][0][0]
    cost=CARDS[cid]['cost']
    s['players'][0]['tokens']=[*cost,1]
    s['bank']=[*[4-x for x in cost],4]
    g=E.Game.from_state_json(json.dumps(s),0)
    g.step(45)
    assert observation(g)['phase']=='PayCard' and sum(g.mask())==2
    validate(observation(g))
    return g


def old_mask(o, mask):
    out = mask.copy()
    out[66:76] = False
    for slot, nid in enumerate(o['nobles']):
        out[66+nid] = mask[66+slot]
    return out


def remap_old(probs, observations):
    out = probs.copy()
    out[:, 66:76] = 0
    for i, o in enumerate(observations):
        for slot, nid in enumerate(o['nobles']):
            out[i, 66+slot] = probs[i, 66+nid]
    return out


class Acceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = Runtime()
        cls.base, cls.base_end, base_actions = replay(False)
        cls.extra, cls.extra_end, extra_actions = replay(True)
        cls.base.append(noble_fixture([4,4,4,4,0], base=True))
        cls.tactical = [noble_fixture([0,3,3,0,3]), noble_fixture([4,0,0,4,0]), noble_fixture([1,2,3,1,0], 4)]
        METRICS['functional_replays'] = {'base_transitions': len(base_actions), 'extra_transitions': len(extra_actions),
                                        'base_actions': base_actions, 'extra_actions': extra_actions,
                                        'matches_for_strength': 0, 'gradient_updates': 0}

    def test_01_package_and_structure(self):
        METRICS['inventory'] = verify_package()
        expected = {'s422-100M': 1263745, 's422-200M': 1263745, 'PV422': 12985352}
        for key, params in expected.items():
            ev = self.runtime.evaluator(key)
            self.assertEqual(sum(p.numel() for p in ev.net.parameters()), params)
            self.assertTrue(all(not p.requires_grad for p in ev.net.parameters()))
        p = self.runtime.evaluator('PV422').net
        self.assertIsNot(p.policy, p.value)
        self.assertEqual(p.temperature, 1.3740903342345823)
        METRICS['loaded_parameter_counts'] = expected

    def test_02_100m_and_200m_function_preserving_migration(self):
        observations = [observation(g) for g in self.base]
        x = np.array([g.observation() for g in self.base], dtype=np.float32)
        masks = np.array([g.mask() for g in self.base])
        oldx = x[:, :315].copy()
        oldm = np.array([old_mask(o, m) for o, m in zip(observations, masks)])
        for i, o in enumerate(observations):
            oldx[i, 153:163] = [nid in o['nobles'] for nid in range(10)]
        results = {}
        for name in ['s422-100M', 's422-200M']:
            ck = torch.load(ROOT/self.runtime.manifest['models'][name]['path'], weights_only=True)
            old = CardTransformer().eval()
            old.load_state_dict(ck['state_dict'])
            new = self.runtime.evaluator(name).net
            mp = mv = ml = 0.; same = 0
            with torch.inference_mode():
                for start in range(0, len(x), 16):
                    sl = slice(start, start+16)
                    a, va = old(torch.tensor(oldx[sl]), torch.tensor(oldm[sl]))
                    b, vb = new(torch.tensor(x[sl]), torch.tensor(masks[sl]))
                    pa = remap_old(a.softmax(-1).numpy(), observations[sl]); pb = b.softmax(-1).numpy()
                    mapped_logits = remap_old(a.numpy(), observations[sl])
                    mp = max(mp, float(np.max(abs(pa-pb)))); mv = max(mv, float((va-vb).abs().max()))
                    ml = max(ml, float(abs(mapped_logits-b.numpy())[masks[sl]].max()))
                    same += int((pa.argmax(1) == pb.argmax(1)).sum())
            self.assertLess(mp, 2e-5); self.assertLess(mv, 1e-4); self.assertLess(ml, 1e-4)
            self.assertEqual(same, len(x))
            results[name] = dict(states=len(x), max_policy_abs=mp, max_raw_value_abs=mv, max_legal_logit_abs=ml, argmax_agreement=same/len(x))
        METRICS['legacy_migration'] = results

    def test_03_pv_base_function_parity(self):
        obs = [observation(g) for g in self.base]
        masks = np.array([g.mask() for g in self.base])
        oldm = np.array([old_mask(o, m) for o, m in zip(obs, masks)])
        result = {}
        for name in ['PV422']:
            ev = self.runtime.evaluator(name)
            old = Dual(OM.StructuredTransformer(ev.net.policy.config), OM.StructuredTransformer(ev.net.value.config), ev.net.temperature).eval()
            old.policy.load_state_dict(ev.net.policy.state_dict()); old.value.load_state_dict(ev.net.value.state_dict())
            mp = mv = 0.; same = 0
            with torch.inference_mode():
                for start in range(0, len(obs), 16):
                    sl = slice(start, start+16)
                    a, va = old(OM.tensor_batch(OM.encode_observations(obs[sl], E.static_data_json()), 'cpu', oldm[sl]))
                    pa = remap_old(a.softmax(-1).numpy(), obs[sl])
                    pb, vb = ev.predict([None]*len(obs[sl]), masks[sl], obs[sl])
                    mp = max(mp, float(np.max(abs(pa-pb)))); mv = max(mv, float(np.max(abs(va.numpy()-vb))))
                    same += int((pa.argmax(1) == pb.argmax(1)).sum())
            self.assertLess(mp, 2e-4); self.assertLess(mv, 2e-4); self.assertEqual(same, len(obs))
            result[name] = dict(states=len(obs), max_policy_abs=mp, max_value_abs=mv, argmax_agreement=same/len(obs))
        METRICS['pv_base_parity'] = result

    def test_04_all_observations_masks_and_extra_100m(self):
        phases = set()
        count = 0
        for g in self.base+self.extra+self.tactical:
            o = observation(g); validate(o); phases.add(o['phase'])
            for profile in ['easy', 'medium']:
                r = self.runtime.infer(o, profile, legal_mask=g.mask())
                self.assertTrue(g.mask()[r['action_index']])
                self.assertTrue(all(p == 0 for p, legal in zip(r['policy'], g.mask()) if not legal))
                count += 1
        self.assertEqual(phases, {'Play', 'PayCard', 'Discard', 'ChooseNoble'})
        METRICS['legal_adapter_predictions'] = count
        METRICS['covered_phases'] = sorted(phases)

    def test_05_catalog_reindex_and_slot_permutation(self):
        cases = self.tactical+[self.base[-1]]
        errors = {}
        for name in ['s422-100M','s422-200M','PV422']:
            ev = self.runtime.evaluator(name); worst = 0.
            for g in cases:
                o = observation(g); _, _, x, mask, _ = native_root(o)
                p, v = ev.predict([x], [mask], [o])
                renamed = copy.deepcopy(o); n = len(o['noble_catalog'])
                renamed['noble_catalog'].reverse(); renamed['nobles'] = [n-1-i for i in o['nobles']]
                for pl in renamed['players']: pl['nobles'] = [n-1-i for i in pl['nobles']]
                _, _, xx, mm, _ = native_root(renamed)
                pp, vv = ev.predict([xx], [mm], [renamed])
                self.assertTrue(np.array_equal(p, pp)); self.assertTrue(np.array_equal(v, vv))
                perm = copy.deepcopy(o); perm['nobles'].reverse()
                _, _, xx, mm, _ = native_root(perm)
                pp, vv = ev.predict([xx], [mm], [perm]); expected = p.copy()
                expected[:,66:69] = p[:,66:69][:,::-1]
                worst = max(worst, float(np.max(abs(expected-pp))), float(np.max(abs(v-vv))))
            self.assertLess(worst, 2e-4)
            errors[name] = {'catalog_reindex_exact': True, 'slot_permutation_max_abs': worst}
        METRICS['noble_invariance'] = errors

    def test_06_claim_scoring_terminal_and_slot_shrink(self):
        scores = []
        for g in self.tactical:
            o = observation(g); points = o['noble_catalog'][0]['points']; before = o['players'][1]['points']
            with self.assertRaises(ValueError): g.clone().step(68)
            end = g.clone(); end.step(66)
            self.assertTrue(end.done()); self.assertEqual(observation(end)['players'][1]['points'], before+points)
            r = self.runtime.infer(observation(end), 'hell')
            self.assertEqual(r['winners'], [1]); self.assertIsNone(r['action']); self.assertEqual(r['simulations'], 0)
            scores.append({'requirements': o['noble_catalog'][0]['req'], 'points': points, 'final_points': before+points})
        g = noble_fixture([0,3,3,0,3], seat=0)
        o = observation(g); ids = ['page:1011', 7077, 'arbitrary-C']
        r = self.runtime.infer(o, 'easy', noble_external_ids=ids)
        self.assertEqual(r['action']['external_id'], ids[o['nobles'][r['action_index']-66]])
        g.step(66); after = observation(g)
        self.assertFalse(g.done()); self.assertTrue(after['final_round_triggered'])
        self.assertEqual(after['nobles'], [1,2])
        self.assertEqual(describe_action(66, after, ids)['external_id'], 7077)
        # A later eligible turn uses the shrunken public list, not the old slot.
        state = json.loads(g.state_json()); state['current']=0; state['phase']='ChooseNoble'
        shrunk = E.Game.from_state_json(json.dumps(state), 0)
        r = self.runtime.infer(observation(shrunk), 'hell', noble_external_ids=ids)
        self.assertTrue(r['forced']); self.assertEqual(r['action']['catalog_index'], 1)
        self.assertEqual(r['action']['external_id'], 7077)
        METRICS['extra_scoring'] = scores

    def test_07_incomplete_or_privileged_input_rejected(self):
        complete = next(observation(g) for g in self.base if len(observation(g)['players'][0]['owned']) >= 2)
        mutations = []
        o = copy.deepcopy(complete); o['players'][0]['owned_count']=len(o['players'][0]['owned']); o['players'][0]['owned'].pop(); mutations.append(o)
        o = copy.deepcopy(complete); del o['players'][0]['owned']; mutations.append(o)
        o = copy.deepcopy(complete); o['players'][0]['owned'].pop(); mutations.append(o)
        o = copy.deepcopy(complete); o['decks']=[[],[],[]]; mutations.append(o)
        o = copy.deepcopy(complete); o['viewer']=1-o['current']; mutations.append(o)
        o = copy.deepcopy(complete); o['bank'][0]+=1; mutations.append(o)
        o = copy.deepcopy(complete); o['pending_purchase']={'card_id':0}; mutations.append(o)
        for o in mutations:
            with self.assertRaises(ObservationError): self.runtime.infer(o, 'hard')
        with self.assertRaises(ObservationError): self.runtime.infer(json.loads(self.base[0].state_json()), 'hard')
        with self.assertRaises(ObservationError): self.runtime.infer(complete, legal_mask=[True]*83)
        g=E.Game(10); g.step(30); g.step(42)
        o=observation(g); self.assertIsNone(o['players'][1]['reserved'][0])
        leaked=copy.deepcopy(o); leaked['players'][1]['reserved'][0]=json.loads(g.state_json())['players'][1]['reserved'][0]
        with self.assertRaises(ObservationError): self.runtime.infer(leaked, 'hard')
        METRICS['rejected_invalid_cases'] = len(mutations)+3

    def test_08_hidden_world_boundary(self):
        g=E.Game(10); g.step(30); g.step(42); state=json.loads(g.state_json())
        state['players'][1]['reserved'][0], state['decks'][0][-1] = state['decks'][0][-1], state['players'][1]['reserved'][0]
        for deck in state['decks']: deck.reverse()
        other=E.Game.from_state_json(json.dumps(state),0)
        self.assertNotEqual(g.state_json(),other.state_json())
        self.assertEqual(g.observation_json(),other.observation_json())
        self.assertEqual(g.observation(),other.observation())
        a=self.runtime.infer(observation(g),'hard',seed=77); b=self.runtime.infer(observation(other),'hard',seed=77)
        for key in ['policy','value','action_index','observation_sha256']:
            self.assertEqual(a[key],b[key])
        self.assertEqual(a['search']['visits'],b['search']['visits'])
        METRICS['hidden_world_invariance'] = True

    def test_09_search_budgets_and_forced_bypass(self):
        roots = [self.extra[0],payment_fixture()]
        roots.append(next(g for g in self.extra if observation(g)['phase']=='Discard' and sum(g.mask())>1))
        roots.append(self.tactical[0])
        ev=self.runtime.evaluator('PV422'); evidence=[]
        for g in roots:
            for profile,budget in [('hard',128),('hell',256)]:
                r=self.runtime.infer(observation(g),profile,seed=42,legal_mask=g.mask())
                self.assertIs(self.runtime.evaluator('PV422'),ev)
                self.assertEqual(r['simulations'],budget); self.assertEqual(sum(r['search']['visits']),budget)
                self.assertTrue(np.isfinite(r['search']['q']).all())
                if observation(g)['phase']=='ChooseNoble':
                    self.assertEqual(r['search']['q'][66],1.0)
                    self.assertGreater(r['search']['exact_terminal_evaluations'],0)
                evidence.append({'phase':r['phase'],'profile':profile,'simulations':budget,'wall_seconds':r['wall_seconds'],
                                 'action_index':r['action_index'],'max_depth':r['search']['max_depth']})
        forced=next(g for g in self.extra if sum(g.mask())==1)
        fresh=Runtime(); r=fresh.infer(observation(forced),'hell')
        self.assertTrue(r['forced']); self.assertEqual(r['simulations'],0); self.assertEqual(fresh.loaded_models(),[])
        METRICS['search_functional_timing'] = evidence
        METRICS['forced_bypass_without_loading'] = True

    def test_10_independent_value_calibration(self):
        ev=self.runtime.evaluator('PV422'); o=observation(self.extra[0]); mask=self.extra[0].mask()
        from splendor_local.vendor.model import encode_observations,tensor_batch
        b=tensor_batch(encode_observations([o],E.static_data_json()),'cpu',[mask])
        with torch.inference_mode():
            _,v=ev.net(b); w=(ev.net.value.forward_outputs(b)['wdl_logits']/1.3740903342345823).softmax(-1)
            self.assertTrue(torch.equal(v,w[:,2]-w[:,0]))
            # A broken or changed policy value head must not change evaluation.
            original=ev.net.policy.forward
            ev.net.policy.forward=lambda batch:(original(batch)[0],torch.tensor([123.]))
            try: self.assertTrue(torch.equal(v,ev.net(b)[1]))
            finally: ev.net.policy.forward=original
        METRICS['independent_calibrated_value'] = True

    def test_11_hint_model_selection_is_independent(self):
        s=LocalSession(self.runtime,opponent_profile='easy',hint_profile='medium')
        o=observation(self.extra[0])
        self.assertEqual(s.suggest(o)['model'],'s422-100M')
        self.assertEqual(s.suggest(o,purpose='hint')['model'],'s422-200M')
        s.configure(hint_profile='hell')
        self.assertEqual(s.settings()['opponent_profile'],'easy')
        hint=s.suggest(o,purpose='hint'); self.assertEqual(hint['simulations'],256)
        s.configure(hint_profile=None)
        self.assertFalse(s.suggest(None,purpose='hint')['enabled'])
        before=s.settings()
        with self.assertRaises(ValueError): s.configure(opponent_profile='hard',hint_profile='bad')
        self.assertEqual(before,s.settings())
        self.assertEqual(s.suggest(o)['model'],'s422-100M')
        METRICS['hint_selector'] = {'independent':True,'off':True,'all_four_profiles_selectable':True}

    def test_12_jsonl_errors_and_cached_session(self):
        o=observation(self.extra[0])
        requests=[{'request_id':'config','command':'configure','opponent_profile':'easy','hint_profile':'medium'},
                  {'request_id':'hint','command':'hint','observation':o},
                  {'request_id':'bad','command':'hint','profile':'hell','observation':o},
                  {'request_id':'move','observation':o},
                  {'command':'configure','hint_profile':None}, {'command':'hint'}]
        output=subprocess.run([sys.executable,'-m','splendor_local','jsonl'],cwd=ROOT,
                              input='\n'.join(map(json.dumps,requests))+'\n',text=True,capture_output=True,check=True)
        rows=[json.loads(x) for x in output.stdout.splitlines()]
        self.assertEqual(len(rows),6)
        self.assertEqual(rows[1]['result']['model'],'s422-200M'); self.assertFalse(rows[2]['ok'])
        self.assertEqual(rows[3]['result']['model'],'s422-100M'); self.assertFalse(rows[5]['result']['enabled'])
        METRICS['jsonl_protocol'] = {'requests':len(rows),'error_recovery':True}

    def test_13_nonterminal_horizon_is_value_not_draw(self):
        s=json.loads(E.Game(123).state_json()); used=set()
        qualified=[c['id'] for c in CARDS if (c['cost'][0] or c['cost'][4]) and (c['cost'][1] or c['cost'][2])]
        for tier in range(3):
            ids=[x for x in qualified if CARDS[x]['tier']==tier+1][:4]; s['display'][tier]=ids; used.update(ids)
        reserves=[x for x in qualified if x not in used][:5]; used.update(reserves)
        s['players'][0]['reserved']=reserves[:2]; s['players'][0]['reserved_public']=[True]*2
        s['players'][1]['reserved']=reserves[2:]; s['players'][1]['reserved_public']=[True]*3
        s['players'][0]['tokens']=[0,4,4,2,0,0]; s['players'][1]['tokens']=[4,0,0,2,4,0]; s['bank']=[0,0,0,0,0,5]
        for tier in range(3): s['decks'][tier]=[c['id'] for c in CARDS if c['tier']==tier+1 and c['id'] not in used]
        g=E.Game.from_state_json(json.dumps(s),0); o=observation(g); validate(o)
        search=E.Search(json.dumps(o),128,0,1.5,128); forced_cutoffs=0
        while not search.done():
            rid,kind,_,mask,raw=search.requests()[0]; v=json.loads(raw)
            if kind=='cutoff' and sum(mask)==1:
                self.assertEqual(v['viewer'],0); self.assertGreaterEqual(v['round'],128)
                self.assertNotEqual(v['phase'],'GameOver'); forced_cutoffs+=1
            prior=[float(x) for x in mask]
            if mask[30]: prior=[float(i==30) for i in range(83)]
            elif mask[65]: prior=[float(i==65) for i in range(83)]
            search.submit(rid,prior,.375)
        r=json.loads(search.result_json())
        self.assertGreater(forced_cutoffs,0); self.assertEqual(r['simulations'],128)
        self.assertEqual(r['root_value'],.375); self.assertEqual(r['exact_terminal_evaluations'],0)
        METRICS['horizon']={'forced_cutoffs':forced_cutoffs,'horizon_evaluations':r['horizon_evaluations'],
                            'root_value':r['root_value'],'simulations':r['simulations']}


if __name__ == '__main__':
    started=time.perf_counter()
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Acceptance))
    METRICS.update(passed=result.wasSuccessful(),tests_run=result.testsRun,seconds=time.perf_counter()-started,
                   failures=[{'test':str(t),'trace':trace} for t,trace in result.failures+result.errors],
                   weights_unchanged=verify_package()['passed'])
    (ROOT/'evidence').mkdir(exist_ok=True)
    (ROOT/'evidence/acceptance.json').write_text(json.dumps(METRICS,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    sys.exit(0 if result.wasSuccessful() else 1)
