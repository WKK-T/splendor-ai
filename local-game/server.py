"""Loopback-only browser game and local model service. No cloud connection."""
from __future__ import annotations
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser

APP = Path(__file__).resolve().parent
MODELS = APP/'models' if (APP/'models').exists() else APP.parent/'local-models/four-level-20261018'
sys.path.insert(0, str(MODELS))
from splendor_local import Runtime
from splendor_local.observation import STATIC, validate

IDENTITY = 'splendor-local-game/1'
RUNTIME = None
PENDING = {}
LOCK = threading.Lock()


def adapt_observation(raw, original_mask):
    if not isinstance(raw, dict) or raw.get('ruleset_version') != 'splendor-original-v2':
        raise ValueError('当前游戏规则版本不匹配')
    if not isinstance(original_mask, list) or len(original_mask) != 83 or any(type(x) not in (int,bool) or x not in (0,1) for x in original_mask):
        raise ValueError('需要完整的合法行动列表')
    o = json.loads(json.dumps(raw))
    if 'noble_catalog' in o:
        raise ValueError('基础游戏不能覆盖贵族目录')
    o['ruleset_version'] = 'splendor-pv-attribute-nobles-v1'
    o['noble_catalog'] = [{'points':n['points'],'req':n['req']} for n in STATIC['nobles']]
    o = validate(o)
    mask = [bool(x) for x in original_mask]
    mask[66:76] = [False]*10
    for slot,nid in enumerate(o['nobles']):
        mask[66+slot] = bool(original_mask[66+nid])
    # Reject a legal flag pointing to a noble that is no longer public.
    if any(original_mask[66+n] and n not in o['nobles'] for n in range(10)):
        raise ValueError('贵族行动与当前牌桌不一致')
    return o, mask


def infer(payload, cancelled):
    if set(payload) != {'request_id','profile','observation','legal_mask','binding'}:
        raise ValueError('请求字段不完整或包含未知信息')
    if payload['profile'] not in ('easy','medium','hard','hell'):
        raise ValueError('请选择四档模型之一')
    binding=payload['binding']
    if not isinstance(binding,dict) or len(json.dumps(binding))>2048:
        raise ValueError('无效局面标记')
    o,mask=adapt_observation(payload['observation'],payload['legal_mask'])
    if binding.get('actor') != o['current'] or binding.get('phase') != o['phase']:
        raise ValueError('当前回合与请求标记不一致')
    seed=int(hashlib.sha256(json.dumps(o,sort_keys=True).encode()).hexdigest()[:8],16)
    r=RUNTIME.infer(o,payload['profile'],seed=seed,legal_mask=mask,cancelled=cancelled)
    index=r['action_index']
    if index is None:
        raise ValueError('对局已经结束')
    if 66 <= index < 76:
        index=66+o['nobles'][index-66]
    if not payload['legal_mask'][index]:
        raise ValueError('模型返回了不可执行的行动')
    return {'index':index,'mask':payload['legal_mask'],'profile':r['profile'],'model':r['model'],
            'simulations':r['simulations'],'wall_seconds':r['wall_seconds'],'forced':r['forced']}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args)>1 else '') not in ('200','204'):
            print(fmt%args, flush=True)

    def origin(self):
        return f'http://127.0.0.1:{self.server.server_port}'

    def valid_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}')

    def send_json(self, status, data):
        raw=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass

    def do_GET(self):
        if not self.valid_host():return self.send_json(403,{'error':'本地访问地址不匹配'})
        path=urllib.parse.urlsplit(self.path).path
        if path == '/api/health':
            return self.send_json(200,{'app':IDENTITY,'profiles':['easy','medium','hard','hell'],'ready':True})
        if path not in ('/','/index.html','/favicon.ico'):
            return self.send_json(404,{'error':'页面不存在'})
        if path == '/favicon.ico':
            self.send_response(204);self.end_headers();return
        raw=(APP/'web/index.html').read_bytes()
        self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass

    def do_POST(self):
        if not self.valid_host() or self.headers.get('Origin') not in (self.origin(),f'http://localhost:{self.server.server_port}') or self.headers.get('X-Splendor-Local')!='1':
            return self.send_json(403,{'ok':False,'error':'请从本机游戏页面发起操作'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=65536 or self.headers.get_content_type()!='application/json':
                raise ValueError('无效请求大小或格式')
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError('请求必须为对象')
            rid=data.get('request_id')
            if not isinstance(rid,str) or not 1<=len(rid)<=120:raise ValueError('无效请求编号')
            if self.path=='/api/cancel':
                with LOCK:
                    event=PENDING.get(rid)
                    if event:event.set()
                return self.send_json(200,{'ok':True})
            if self.path!='/api/infer':return self.send_json(404,{'ok':False,'error':'接口不存在'})
            event=threading.Event()
            with LOCK:
                if rid in PENDING or len(PENDING)>=8:raise ValueError('模型请求繁忙，请稍后再试')
                PENDING[rid]=event
            deadline=time.monotonic()+110
            try:
                result=infer(data,lambda:event.is_set() or time.monotonic()>deadline)
                self.send_json(200,{'ok':True,'request_id':rid,'binding':data['binding'],'result':result})
            finally:
                with LOCK:PENDING.pop(rid,None)
        except InterruptedError:
            self.send_json(409,{'ok':False,'error':'本次计算已取消'})
        except (ValueError,TypeError,KeyError) as exc:
            self.send_json(400,{'ok':False,'error':str(exc)})
        except Exception as exc:
            print('Model error:',repr(exc),flush=True)
            self.send_json(500,{'ok':False,'error':'本地模型计算失败，请查看启动窗口或重新启动游戏'})


def main():
    global RUNTIME
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8780);p.add_argument('--open',action='store_true');p.add_argument('--check',action='store_true')
    args=p.parse_args()
    if args.check:
        from splendor_local import verify_package
        result=verify_package()
        o=json.loads((MODELS/'examples/base-observation.json').read_text())
        r=Runtime().infer(o,'medium')
        print(json.dumps({'passed':result['passed'],'model':r['model'],'action':r['action_index']}));return
    RUNTIME=Runtime()
    server=None
    for port in range(args.port,args.port+20):
        try:server=ThreadingHTTPServer(('127.0.0.1',port),Handler);break
        except OSError:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=.4) as reply:state=json.load(reply)
                if state.get('app')==IDENTITY:
                    if args.open:webbrowser.open(f'http://127.0.0.1:{port}/')
                    print(f'游戏已经启动：http://127.0.0.1:{port}/');return
            except Exception:pass
    if server is None:raise RuntimeError('无法找到可用的本地端口')
    print(f'璀璨宝石本地版：http://127.0.0.1:{server.server_port}/\n请保持这个窗口开启。关闭窗口或按 Ctrl+C 可结束服务。',flush=True)
    if args.open:webbrowser.open(f'http://127.0.0.1:{server.server_port}/')
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':main()
