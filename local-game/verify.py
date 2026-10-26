"""Focused local integration/portable-engine checks; no training or arena."""
import importlib.util
import json
from pathlib import Path
import sys
import threading
import time
import urllib.request
import urllib.error
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'local-models/four-level-20261018'))
import server
from splendor_local import Runtime, verify_package
from splendor_local.observation import engine as E
from splendor_local.vendor.splendor_pv_noble_search.portable import Search as Portable
import acceptance as fixtures


def payload(game,profile='medium',rid='test'):
    o=fixtures.observation(game)
    mask=fixtures.old_mask(o,np.asarray(game.mask())).astype(int).tolist()
    o.pop('noble_catalog',None);o['ruleset_version']='splendor-original-v2'
    return {'request_id':rid,'profile':profile,'observation':o,'legal_mask':mask,
            'binding':{'actor':o['current'],'phase':o['phase'],'session':1,'revision':1}}


def main():
    metrics={'package':verify_package()['passed']};runtime=Runtime();server.RUNTIME=runtime
    start=time.perf_counter();original=E.Search
    o=fixtures.observation(E.Game(7))
    a=original(json.dumps(o),128,42,1.5,128);b=Portable(json.dumps(o),128,42,1.5,128)
    count=0
    while not a.done():
        ar=a.requests()[0];br=b.requests()[0]
        assert ar[:2]==tuple(br[:2]) and ar[3]==br[3] and json.loads(ar[4])==json.loads(br[4])
        np.testing.assert_array_equal(np.asarray(ar[2],dtype=np.float32),np.asarray(br[2],dtype=np.float32))
        priors=[float(v) for v in ar[3]]
        a.submit(ar[0],priors,.375);b.submit(br[0],priors,.375);count+=1
    assert b.done() and json.loads(a.result_json())==json.loads(b.result_json())
    metrics['search_core_parity']={'requests':count,'exact_result':True}
    rows=[]
    for profile in ['easy','medium','hard','hell']:
        E.Search=original;n=runtime.infer(o,profile,seed=42)
        E.Search=Portable;p=runtime.infer(o,profile,seed=42)
        assert n['action_index']==p['action_index'] and n['simulations']==p['simulations']
        np.testing.assert_allclose(n['policy'],p['policy'],rtol=0,atol=1e-7)
        assert n['legal_mask']==p['legal_mask']
        rows.append({'profile':profile,'action':p['action_index'],'simulations':p['simulations'],
                     'native_seconds':n['wall_seconds'],'portable_seconds':p['wall_seconds']})
    E.Search=original;metrics['four_profiles']=rows
    # Same base-game wire format as the browser, including ID/slot remapping.
    states,_,_=fixtures.replay(False)
    sample={fixtures.observation(g)['phase']:g for g in states}
    g=fixtures.noble_fixture([4,0,0,0,4],base=True)
    s=json.loads(g.state_json());s['nobles']=[4,1,2]
    sample['ChooseNoble']=E.Game.from_state_json(json.dumps(s),0)
    adapter=[]
    for phase,g in sample.items():
        r=server.infer(payload(g),lambda:False)
        assert payload(g)['legal_mask'][r['index']]
        adapter.append(phase)
    metrics['browser_action_adapter_phases']=adapter
    bad=payload(E.Game(7));bad['observation']['decks']=[[],[],[]]
    try:server.infer(bad,lambda:False);raise AssertionError('private fields accepted')
    except ValueError:pass
    try:runtime.infer(o,'hell',cancelled=lambda:True);raise AssertionError('cancellation ignored')
    except InterruptedError:pass
    # Exercise real concurrent HTTP cancellation and origin/path boundaries.
    http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
    threading.Thread(target=http.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{http.server_port}'
    def request(path,data=None,allowed=True):
        headers={'Content-Type':'application/json','Origin':origin if allowed else 'https://example.invalid','X-Splendor-Local':'1'}
        req=urllib.request.Request(origin+path,data=json.dumps(data).encode() if data else None,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=30) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:return e.code,json.load(e)
    assert request('/api/health')[1]['ready']
    assert request('/models/weights/PV422-inference.pt')[0]==404
    assert request('/api/infer',payload(E.Game(7)),False)[0]==403
    bad=payload(E.Game(7));bad['profile']='invalid-profile';assert request('/api/infer',bad)[0]==400
    results=[]
    t=threading.Thread(target=lambda:results.append(request('/api/infer',payload(E.Game(7),'hell','cancel-me'))));t.start()
    end=time.monotonic()+5
    while 'cancel-me' not in server.PENDING and time.monotonic()<end:time.sleep(.001)
    assert 'cancel-me' in server.PENDING
    assert request('/api/cancel',{'request_id':'cancel-me'})[0]==200
    t.join(10);assert not t.is_alive() and results[0][0]==409
    http.shutdown();http.server_close()
    metrics.update(passed=True,http_origin_guard=True,private_weights_not_served=True,cancellation=True,invalid_profile_rejected=True,seconds=time.perf_counter()-start)
    out=ROOT/'output/local-game-verification/integration.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps(metrics,indent=2))


if __name__=='__main__':main()
