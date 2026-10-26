#!/usr/bin/env python3
"""Package the tested macOS Apple Silicon local game and its offline runtime.

Use an existing relocatable Python runtime with --runtime-dir, or run this
script with the Python environment whose dependencies should be bundled.
The script neither publishes nor modifies the model weights.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'local-models/four-level-20261018'
DEPENDENCIES = ['torch', 'numpy', 'filelock', 'typing_extensions', 'setuptools',
                'sympy', 'mpmath', 'networkx', 'jinja2', 'MarkupSafe', 'fsspec', 'wasmtime']
IGNORE = shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store', 'target', '.git')


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def copytree(source, dest):
    shutil.copytree(source, dest, dirs_exist_ok=True, ignore=IGNORE)


def verify_models():
    manifest = json.loads((MODELS / 'manifest.json').read_text())
    for entry in manifest['models'].values():
        p = MODELS / entry['path']
        if not p.exists() or sha256(p) != entry['sha256']:
            raise SystemExit('Missing or invalid models. Run python3 scripts/download_models.py first.')
    for name, entry in manifest['vendor_files'].items():
        if sha256(MODELS / name) != entry['sha256']:
            raise SystemExit(f'Runtime integrity mismatch: {name}')


def prepare_runtime(folder, source, source_manifest):
    runtime = folder / 'runtime'
    rows = []
    if source:
        copytree(source, runtime)
        if source_manifest:
            rows = json.loads(source_manifest.read_text())
    else:
        if platform.system() != 'Darwin' or platform.machine() != 'arm64' or sys.version_info[:2] != (3, 12):
            raise SystemExit('Build with a relocatable macOS arm64 Python 3.12 runtime.')
        copytree(Path(sys.base_prefix), runtime)
        site = runtime / 'lib/python3.12/site-packages'
        site.mkdir(parents=True, exist_ok=True)
        for name in DEPENDENCIES:
            dist = metadata.distribution(name)
            for rel in dist.files or []:
                if '..' in rel.parts or '__pycache__' in rel.parts or rel.suffix == '.pyc':
                    continue
                p = dist.locate_file(rel)
                if p.is_file():
                    out = site / str(rel)
                    out.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(p, out)
            rows.append({'name': name, 'version': dist.version})
        rows.append({'name': 'python', 'version': sys.version.split()[0],
                     'source': 'relocatable python-build-standalone runtime'})
    if not (runtime / 'bin/python3.12').exists():
        raise SystemExit('Runtime must contain bin/python3.12.')
    # Python's build metadata may retain the packager's installation directory.
    # It is not used to locate the running interpreter; make it anonymous.
    for p in runtime.glob('lib/python3.12/_sysconfigdata*.py'):
        content = p.read_text()
        content = re.sub(r'/Users/[^/"\s]+/[^"\s]*(?=/bin|/lib|/include|/share)', '/opt/splendor/runtime', content)
        content = re.sub(r'/Users/[^/"\s]+/[^"\s]*', '/opt/splendor/runtime', content)
        p.write_text(content)
    library = runtime / 'lib/libpython3.12.dylib'
    if library.exists():
        subprocess.run(['install_name_tool', '-id', '@rpath/libpython3.12.dylib', str(library)], check=True)
        subprocess.run(['codesign', '--force', '--sign', '-', str(library)], check=True)
    (folder / 'runtime-components.json').write_text(json.dumps(rows, indent=2) + '\n')


def prepare(folder, args):
    verify_models()
    web = ROOT / 'local-game/web/index.html'
    if not web.exists():
        raise SystemExit('Build the local page first: python3 play/build.py --local-game --output-dir local-game/web')
    if folder.exists():
        raise SystemExit(f'Staging directory already exists; use --archive-only or choose another --stage-dir: {folder}')
    folder.mkdir(parents=True)
    app = folder / 'app'
    (app / 'web').mkdir(parents=True)
    shutil.copy2(ROOT / 'local-game/server.py', app / 'server.py')
    shutil.copy2(web, app / 'web/index.html')
    for name in ['splendor_local', 'weights', 'examples']:
        copytree(MODELS / name, app / 'models' / name)
    shutil.copy2(MODELS / 'manifest.json', app / 'models/manifest.json')
    licenses = folder / 'licenses'
    licenses.mkdir()
    if (ROOT / 'licenses').exists():
        copytree(ROOT / 'licenses', licenses)
    for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'ASSET_LICENSE.md', 'MODEL_LICENSE.md']:
        if (ROOT / name).exists():
            shutil.copy2(ROOT / name, licenses / name)
    source = folder / 'source'
    source.mkdir()
    copytree(ROOT / 'local-game/native-portable', source / 'native-portable')
    shutil.copy2(ROOT / 'local-game/client.js', source / 'client.js')
    (source / 'README.txt').write_text('Complete product source and build instructions: https://github.com/WKK-T/splendor-ai\n'
                                      'The Python inference and native search sources are also in app/models/splendor_local.\n')
    prepare_runtime(folder, args.runtime_dir, args.runtime_manifest)
    launcher = folder / '启动游戏.command'
    launcher.write_text('''#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
export PYTHONHOME="$PWD/runtime"
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
echo "正在启动璀璨宝石 / Starting Splendor AI…"
"$PWD/runtime/bin/python3.12" -s -B "$PWD/app/server.py" --open
game_status=$?
if [ "$game_status" -ne 0 ]; then
  echo "启动失败，请保留上方错误信息。Press Return to close."
  read -r
fi
exit "$game_status"
''')
    launcher.chmod(0o755)
    (folder / 'README.txt').write_text(f'''璀璨宝石 / Splendor AI · v{args.version}
由 Codex 完成的 VibeCoding 产品。Built with Codex through VibeCoding.

适用 Apple Silicon Mac（M1 及更新），macOS 14 及以上。
完整解压后，双击 启动游戏.command；浏览器将自动打开。
保持终端窗口开启。按 Ctrl+C 停止服务。
如果系统阻止首次打开，请在 Finder 中右键该脚本并选择“打开”。
未做 Apple 开发者签名或公证。请仅运行你信任来源的下载。

包含 Python、依赖、三个模型、卡面与游戏规则，无需登录或在线下载。
简单机器人：Greedy 规则策略。
AI 模型简单：Transformer seed422，100M 训练行动。
AI 模型中等：Transformer seed422，200M 训练行动。
AI 模型困难：PV422，128 次搜索模拟。
AI 模型地狱：PV422，256 次搜索模拟。
100M/200M 指训练行动数，并非参数量。难度名称不是人类棋力评级。

提示模型独立选择，点击伙伴的“提示”获取建议，不会自动行动。
计算仅在本机运行；服务监听 127.0.0.1，只供本机浏览器使用。
保留整个解压文件夹，不能单独分享启动脚本。

Mac 包已在 Apple Silicon 实际运行验证。
完整源码：https://github.com/WKK-T/splendor-ai
模型及运行文件校验：package-files.sha256.json。
第三方许可证保留在 licenses、runtime 与各组件的 dist-info/licenses。
''', encoding='utf-8-sig')


def archive(folder, out):
    listing = {str(p.relative_to(folder)): sha256(p) for p in sorted(folder.rglob('*'))
               if p.is_file() and p.name != 'package-files.sha256.json'}
    (folder / 'package-files.sha256.json').write_text(json.dumps(listing, ensure_ascii=False, indent=2) + '\n')
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(folder.rglob('*')):
            if p.is_file():
                z.write(p, str(p.relative_to(folder.parent)))
    with zipfile.ZipFile(out) as z:
        if z.testzip() is not None:
            raise SystemExit('Archive integrity check failed.')
    digest = sha256(out)
    out.with_suffix('.zip.sha256').write_text(f'{digest}  {out.name}\n')
    print(json.dumps({'archive': str(out), 'bytes': out.stat().st_size, 'sha256': digest}, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--version', default='1.0.0')
    p.add_argument('--runtime-dir', type=Path)
    p.add_argument('--runtime-manifest', type=Path)
    p.add_argument('--stage-dir', type=Path)
    p.add_argument('--stage-only', action='store_true')
    p.add_argument('--archive-only', action='store_true')
    args = p.parse_args()
    name = f'splendor-ai-macos-arm64-v{args.version}'
    folder = args.stage_dir or ROOT / 'output/packages' / name
    if not args.archive_only:
        prepare(folder, args)
    if not args.stage_only:
        archive(folder, ROOT / 'dist' / f'{name}.zip')


if __name__ == '__main__':
    main()
