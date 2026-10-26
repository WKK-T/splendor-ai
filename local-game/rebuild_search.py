#!/usr/bin/env python3
"""Rebuild public search binaries on macOS arm64, preserving model weights."""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'local-models/four-level-20261018'
VENDOR = MODELS / 'splendor_local/vendor'


def run(*args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def main():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise SystemExit('The distributed native binary targets macOS arm64.')
    cargo = shutil.which('cargo')
    if not cargo:
        raise SystemExit('Install Rust and put cargo on PATH first.')
    env = os.environ.copy()
    env['CARGO_ENCODED_RUSTFLAGS'] = '\x1f'.join([
        f'--remap-path-prefix={Path.home()}=/build', '-C', 'strip=symbols'])
    env['PYO3_PYTHON'] = sys.executable
    run(cargo, '+stable', 'build', '--locked', '--release', '--manifest-path', VENDOR/'native/Cargo.toml', env=env)
    run(cargo, '+stable', 'build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
        '--manifest-path', ROOT/'local-game/native-portable/Cargo.toml', env=env)
    native = VENDOR/'splendor_pv_noble_search/splendor_pv_noble_search.abi3.so'
    wasm = VENDOR/'splendor_pv_noble_search/search.wasm'
    shutil.copy2(VENDOR/'native/target/release/libsplendor_pv_noble_search.dylib', native)
    shutil.copy2(ROOT/'local-game/native-portable/target/wasm32-unknown-unknown/release/splendor_portable_search.wasm', wasm)
    run('install_name_tool', '-id', '@rpath/splendor_pv_noble_search.abi3.so', native)
    run('codesign', '--force', '--sign', '-', native)
    manifest = json.loads((MODELS/'manifest.json').read_text())
    for p in [native, wasm]:
        manifest['vendor_files'][str(p.relative_to(MODELS))]['sha256'] = hashlib.sha256(p.read_bytes()).hexdigest()
    (MODELS/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    print('Binaries rebuilt. Run local-game/verify.py and model acceptance.py before packaging.')


if __name__ == '__main__':
    main()
