"""Offline command line. jsonl keeps one cache alive for multiple requests."""
import argparse
import json
from pathlib import Path
import sys

from .inference import Runtime, manifest, verify_package
from .observation import engine
from .session import LocalSession, OPTIONS


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('verify', help='verify packaged weights and frozen algorithms')
    sub.add_parser('profiles', help='show candidate profiles without loading networks')
    demo = sub.add_parser('example', help='emit a public starting observation; not a game match')
    demo.add_argument('--extra', action='store_true')
    infer = sub.add_parser('infer', help='evaluate one public observation JSON file')
    infer.add_argument('file', type=Path)
    infer.add_argument('--profile', choices=list(manifest()['profiles']), default='medium')
    infer.add_argument('--seed', type=int, default=0)
    hint = sub.add_parser('hint', help='evaluate a teaching hint using an independently selected model')
    hint.add_argument('file', type=Path)
    hint.add_argument('--model', choices=[*OPTIONS, 'off'], default='medium')
    hint.add_argument('--seed', type=int, default=0)
    sub.add_parser('jsonl', help='one request/response per stdin/stdout line; cached models')
    a = p.parse_args()
    if a.command == 'verify':
        emit(verify_package())
    elif a.command == 'profiles':
        emit(manifest()['profiles'])
    elif a.command == 'example':
        from .inference import ROOT
        emit(json.loads((ROOT/'examples'/('extra-observation.json' if a.extra else 'base-observation.json')).read_text()))
    elif a.command == 'infer':
        emit(Runtime().infer(json.loads(a.file.read_text()), a.profile, seed=a.seed))
    elif a.command == 'hint':
        emit(LocalSession(hint_profile=None if a.model == 'off' else a.model).suggest(
            json.loads(a.file.read_text()), purpose='hint', seed=a.seed))
    else:
        runtime = Runtime()
        session = LocalSession(runtime)
        for line in sys.stdin:
            if not line.strip():
                continue
            request = None
            try:
                request = json.loads(line)
                if type(request) is not dict:
                    raise ValueError('request must be an object')
                command = request.get('command', 'infer')
                if command == 'configure':
                    if request.keys()-{'request_id', 'command', 'opponent_profile', 'hint_profile'}:
                        raise ValueError('unknown configuration fields')
                    settings = session.configure(**{k: request[k] for k in ('opponent_profile', 'hint_profile') if k in request})
                    emit({'request_id': request.get('request_id'), 'ok': True, 'settings': settings})
                    continue
                if command not in ('infer', 'hint'):
                    raise ValueError('command must be infer, hint, or configure')
                allowed = {'request_id', 'command', 'observation', 'profile', 'seed', 'noble_external_ids', 'legal_mask'}
                if request.keys()-allowed:
                    raise ValueError('unknown request fields')
                kwargs = dict(seed=request.get('seed', 0), noble_external_ids=request.get('noble_external_ids'),
                              legal_mask=request.get('legal_mask'))
                if command == 'hint':
                    if 'profile' in request:
                        raise ValueError('select hint_profile with configure; hint and opponent selections are independent')
                    result = session.suggest(request.get('observation'), purpose='hint', **kwargs)
                elif 'profile' in request:
                    result = runtime.infer(request['observation'], request['profile'], **kwargs)
                else:
                    result = session.suggest(request['observation'], purpose='opponent', **kwargs)
                emit({'request_id': request.get('request_id'), 'ok': True, 'result': result})
            except (ValueError, KeyError, TypeError, RuntimeError) as exc:
                emit({'request_id': request.get('request_id') if isinstance(request, dict) else None,
                      'ok': False, 'error': str(exc), 'error_type': type(exc).__name__})


if __name__ == '__main__':
    main()
