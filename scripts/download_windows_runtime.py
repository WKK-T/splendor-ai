#!/usr/bin/env python3
"""Fetch the pinned Windows x64 runtime without installing anything system-wide."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCK = Path(__file__).with_name('windows-runtime-lock.json')


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def fetch(cache, item):
    path = cache / item['filename']
    if path.exists():
        if path.stat().st_size != item['bytes'] or sha256(path) != item['sha256']:
            raise ValueError(f'Cached runtime checksum mismatch: {path.name}')
        return path
    temporary = path.with_suffix(path.suffix + '.part')
    request = urllib.request.Request(item['url'], headers={'User-Agent': 'Splendor-AI/1.0.0'})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open('wb') as target:
            for block in iter(lambda: response.read(1024 * 1024), b''):
                target.write(block)
        if temporary.stat().st_size != item['bytes'] or sha256(temporary) != item['sha256']:
            raise ValueError(f'Download checksum mismatch: {path.name}')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Verified {path.name}', flush=True)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=Path, default=ROOT / 'output/windows-runtime')
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda item: fetch(args.cache_dir, item), lock['artifacts']))
    print(f'All {len(lock["artifacts"])} runtime artifacts verified.')


if __name__ == '__main__':
    main()
