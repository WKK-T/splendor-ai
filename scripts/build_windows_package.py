#!/usr/bin/env python3
"""Build the standalone Windows x64 game from hash-locked official components."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import re
import zipfile

from download_windows_runtime import LOCK, sha256

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'local-models/four-level-20261018'
IGNORE = shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store', 'target', '.git')


def copytree(source, destination):
    shutil.copytree(source, destination, dirs_exist_ok=True, ignore=IGNORE)


def unpack_zip(archive, destination, wheel=False):
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError(f'Corrupt runtime archive: {archive.name}')
        for info in z.infolist():
            path = PurePosixPath(info.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in info.filename or ':' in info.filename:
                raise ValueError(f'Unsafe archive member in {archive.name}')
            if info.is_dir():
                continue
            if wheel and path.parts[0].endswith('.data'):
                if len(path.parts) < 3 or path.parts[1] not in ('purelib', 'platlib'):
                    continue
                path = PurePosixPath(*path.parts[2:])
            target = destination.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as source, target.open('wb') as output:
                shutil.copyfileobj(source, output)


def visual_studio_runtime(args, lock):
    """Resolve licensed REDIST sources, never end-user installer payloads."""
    if os.name != 'nt':
        raise SystemExit('The Windows package must be assembled on Windows from Visual Studio REDIST sources.')
    vswhere = Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Microsoft Visual Studio/Installer/vswhere.exe'
    result = subprocess.run([str(vswhere), '-latest', '-products', '*', '-format', 'json', '-utf8'],
                            capture_output=True, encoding='utf-8', check=True)
    installations = json.loads(result.stdout)
    if not installations:
        raise SystemExit('Visual Studio with licensed C++ redistribution components is required.')
    installation = installations[0]
    if installation.get('productId') not in ('Microsoft.VisualStudio.Product.Enterprise', 'Microsoft.VisualStudio.Product.Professional'):
        raise SystemExit('This builder includes the Enterprise/Professional redistribution terms; use the tested Enterprise CI runner.')
    major = int(installation['installationVersion'].split('.')[0])
    year = {17: 2022, 18: 2026}.get(major)
    if year is None:
        raise SystemExit('Unsupported Visual Studio license version; update the bundled official terms first.')
    installation['splendor_license_year'] = year
    install_root = Path(installation['installationPath'])
    redist_root = install_root / 'VC/Redist/MSVC'
    versions = [p for p in redist_root.iterdir() if p.is_dir() and p.name[0].isdigit()]
    versions.sort(key=lambda p: tuple(int(v) for v in re.findall(r'\d+', p.name)), reverse=True)
    candidates = [args.vc_redist_dir.resolve()] if args.vc_redist_dir else versions
    for directory in candidates:
        directory.resolve().relative_to(redist_root.resolve())
        files = {}
        for name in lock['vc_runtime']['required_dlls']:
            matches = list(directory.glob('x64/Microsoft.VC*.CRT/' + name))
            if len(matches) != 1:
                break
            files[name] = matches[0]
        if len(files) == len(lock['vc_runtime']['required_dlls']):
            return installation, install_root, directory, files
    raise SystemExit('Visual Studio REDIST lacks required x64 CRT files (including vcruntime140_threads.dll).')


def install_vc_runtime(folder, resolved, lock):
    installation, install_root, directory, files = resolved
    rows = []
    for name, source in files.items():
        environment = dict(os.environ, SPLENDOR_VC_DLL=str(source))
        version = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command',
            '(Get-Item -LiteralPath $env:SPLENDOR_VC_DLL).VersionInfo.FileVersion'], env=environment, text=True).strip()
        shutil.copy2(source, folder / 'runtime' / name)
        rows.append({'name': name, 'source': source.relative_to(install_root).as_posix(),
                     'bytes': source.stat().st_size, 'sha256': sha256(source), 'file_version': version})
    provenance = {'name': 'Microsoft.VisualStudio.VC.Redist.x64', 'version': directory.name,
                  'visual_studio_version': installation['installationVersion'],
                  'visual_studio_product': installation.get('productId'),
                  'visual_studio_license_year': installation['splendor_license_year'],
                  'redist_version': directory.name, 'files': rows,
                  'redistribution_list': lock['vc_runtime']['redistribution_lists'][str(installation['splendor_license_year'])]}
    return provenance


def copy_microsoft_licenses(folder, year):
    source = ROOT / 'licenses/windows'
    sources = json.loads((source / 'sources.json').read_text(encoding='utf-8'))
    selected = [item for item in sources['files']
                if str(item.get('visual_studio_year')) == str(year) or item['kind'] == 'runtime_use_license_reference']
    if {item['kind'] for item in selected} != {'visual_studio_license', 'redistribution_list', 'runtime_use_license_reference'}:
        raise ValueError('Missing Visual Studio redistribution license documents')
    destination = folder / 'licenses/microsoft'
    destination.mkdir(parents=True, exist_ok=True)
    for item in selected:
        path = source / item['filename']
        if path.stat().st_size != item['bytes'] or sha256(path) != item['sha256']:
            raise ValueError('Microsoft license document integrity mismatch')
        shutil.copy2(path, destination / path.name)
    sources['files'] = selected
    (destination / 'sources.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def verify_inputs(cache, lock):
    for item in lock['artifacts']:
        path = cache / item['filename']
        if not path.exists() or path.stat().st_size != item['bytes'] or sha256(path) != item['sha256']:
            raise SystemExit(f'Missing or incorrect {item["filename"]}; run scripts/download_windows_runtime.py.')
    manifest = json.loads((MODELS / 'manifest.json').read_text(encoding='utf-8'))
    for entry in manifest['models'].values():
        path = MODELS / entry['path']
        if not path.exists() or sha256(path) != entry['sha256']:
            raise SystemExit('Missing or invalid model. Run scripts/download_models.py.')
    for name, entry in manifest['vendor_files'].items():
        if sha256(MODELS / name) != entry['sha256']:
            raise SystemExit(f'Inference source integrity mismatch: {name}')
    return manifest


def prepare(folder, args):
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    manifest = verify_inputs(args.cache_dir, lock)
    vc_source = visual_studio_runtime(args, lock)
    web = ROOT / 'local-game/web/index.html'
    if not web.exists():
        raise SystemExit('First build: python play/build.py --local-game --output-dir local-game/web')
    if folder.exists():
        raise SystemExit('Staging folder exists; use --archive-only or choose another --stage-dir.')
    (folder / 'app/web').mkdir(parents=True)
    shutil.copy2(ROOT / 'local-game/server.py', folder / 'app/server.py')
    shutil.copy2(web, folder / 'app/web/index.html')
    for name in ['splendor_local', 'weights', 'examples']:
        copytree(MODELS / name, folder / 'app/models' / name)
    # Windows uses the checked-in portable Rust/WASM core. Do not ship Mac binaries.
    for name in list(manifest['vendor_files']):
        if name.endswith('.so'):
            (folder / 'app/models' / name).unlink()
            del manifest['vendor_files'][name]
    (folder / 'app/models/manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    runtime = folder / 'runtime'
    runtime.mkdir()
    for item in lock['artifacts']:
        if item['kind'] not in ('python', 'wheel'):
            continue
        destination = runtime if item['kind'] == 'python' else runtime / 'Lib/site-packages'
        unpack_zip(args.cache_dir / item['filename'], destination, item['kind'] == 'wheel')
    # This is a runtime distribution; C++ extension-build headers, CMake files
    # and native test binaries are not used by the frozen CPU inference path.
    pruning = []
    for relative in ['torch/include', 'torch/share/cmake', 'torch/test']:
        path = runtime / 'Lib/site-packages' / relative
        if path.exists():
            files = [p for p in path.rglob('*') if p.is_file()]
            pruning.append({'path': 'runtime/Lib/site-packages/' + relative,
                            'files': len(files), 'bytes': sum(p.stat().st_size for p in files),
                            'reason': 'C++ development headers, CMake configuration or native tests; not inference runtime'})
            shutil.rmtree(path)
    (folder / 'runtime-pruning.json').write_text(json.dumps(pruning, indent=2) + '\n', encoding='utf-8')
    (runtime / 'python312._pth').write_text('python312.zip\n.\nLib/site-packages\nimport site\n', encoding='ascii')
    vc_provenance = install_vc_runtime(folder, vc_source, lock)
    copytree(ROOT / 'licenses/rust', folder / 'licenses/rust')
    for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md']:
        shutil.copy2(ROOT / name, folder / 'licenses' / name)
    microsoft = folder / 'licenses/microsoft'
    copy_microsoft_licenses(folder, vc_provenance['visual_studio_license_year'])
    (microsoft / 'SOURCE.txt').write_text('Microsoft Visual Studio C++ REDIST components.\n'
        f'Visual Studio product: {vc_provenance["visual_studio_product"]}\n'
        f'Visual Studio version: {vc_provenance["visual_studio_version"]}\n'
        f'CRT version: {vc_provenance["redist_version"]}\n'
        f'Redistribution list: {vc_provenance["redistribution_list"]}\n'
        'The selected Visual Studio license and REDIST list supply the redistribution terms.\n'
        'The runtime-use EULA is included as an end-user reference, not a redistribution grant.\n'
        'These files retain their Microsoft license, not the project MIT license.\n', encoding='utf-8')
    (microsoft / 'vc-redist-provenance.json').write_text(json.dumps(vc_provenance, indent=2) + '\n', encoding='utf-8')
    shutil.copy2(LOCK, folder / 'windows-runtime-lock.json')
    (folder / 'runtime-components.json').write_text(json.dumps(lock['artifacts'] + [vc_provenance], indent=2) + '\n', encoding='utf-8')
    copytree(ROOT / 'local-game/native-portable', folder / 'source/native-portable')
    for name in ['client.js', 'server.py']:
        shutil.copy2(ROOT / 'local-game' / name, folder / 'source' / name)
    (folder / 'source/README.txt').write_text('Complete source: https://github.com/WKK-T/splendor-ai\n'
        'Python inference and native search sources also reside in app/models/splendor_local.\n', encoding='utf-8')
    launcher = r'''@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
set PYTHONHOME=
set PYTHONPATH=
set PYTHONUTF8=1
set PYTHONNOUSERSITE=1
set PYTHONDONTWRITEBYTECODE=1
echo Starting Splendor AI. Your browser will open shortly.
"%~dp0runtime\python.exe" -X utf8 -s -B "%~dp0app\server.py" --open %*
set "GAME_EXIT_CODE=%ERRORLEVEL%"
if not "%GAME_EXIT_CODE%"=="0" (
  echo.
  echo Startup failed. Keep the error above for troubleshooting.
  if not defined SPLENDOR_NO_PAUSE pause
)
popd
exit /b %GAME_EXIT_CODE%
'''
    for name in ['启动游戏.bat', 'Start Splendor.bat']:
        (folder / name).write_bytes(launcher.replace('\n', '\r\n').encode('ascii'))
    (folder / 'README.txt').write_text(f'''璀璨宝石 AI / Splendor AI · v{args.version} · Windows x64
由 Codex 完成的 VibeCoding 产品。Built with Codex through VibeCoding.

适用 64 位 Intel/AMD 的 Windows 10/11；不支持 32 位系统或 Windows ARM。
1. 完整解压到普通文件夹，例如 C:\\Games\\Splendor。不要在压缩包预览中运行。
2. 双击“启动游戏.bat”（或 Start Splendor.bat），浏览器会打开本机游戏。
3. 保持命令窗口开启。关闭窗口或按 Ctrl+C 停止游戏服务。
如果未自动打开浏览器，复制窗口中的 http://127.0.0.1:... 地址。

Python、CPU 推理依赖、规则、插画与三个模型都已包含，不需要安装 Python、
CUDA、系统 VC 运行库或额外下载。无需管理员权限、账号或 API 密钥。
首次加载模型可能稍慢。所有对局计算在本机执行，服务只监听 127.0.0.1。
请保留整个解压文件夹；单独复制网页或启动脚本不能运行四档模型。

对手：简单机器人；AI 简单（seed422 100M）；AI 中等（seed422 200M）；
AI 困难（PV422 搜索128次）；AI 地狱（同一PV422 搜索256次）。
100M/200M是训练采样量，不是参数量。难度名称不是人类等级标定。
提示模型可在设置中独立选择或关闭，提示不会自动替你行动。

如需检查环境，在此文件夹打开命令提示符并运行：
runtime\\python.exe -X utf8 -B app\\server.py --check
如需反馈问题，保留错误文字并注明 Windows 版本和 CPU 型号。
未经代码签名；系统可能要求确认下载来源。不要为运行游戏关闭安全防护。

校验：package-files.sha256.json；运行时来源：windows-runtime-lock.json。
许可：licenses、runtime/LICENSE.txt 和各 Python 组件的 dist-info/licenses。
Microsoft 组件须按 licenses/microsoft 中附带的原始许可条款使用。
完整源码、问题反馈与验证记录：https://github.com/WKK-T/splendor-ai
''', encoding='utf-8-sig')


def archive(folder, destination):
    manifest = {path.relative_to(folder).as_posix(): sha256(path)
                for path in sorted(folder.rglob('*'))
                if path.is_file() and path.name != 'package-files.sha256.json'}
    (folder / 'package-files.sha256.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path in sorted(folder.rglob('*')):
            if path.is_file():
                z.write(path, path.relative_to(folder.parent).as_posix())
    with zipfile.ZipFile(destination) as z:
        if z.testzip() is not None:
            raise ValueError('ZIP integrity check failed')
    digest = sha256(destination)
    destination.with_suffix('.zip.sha256').write_text(f'{digest}  {destination.name}\n', encoding='ascii')
    print(json.dumps({'archive': str(destination), 'bytes': destination.stat().st_size, 'sha256': digest}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default='1.0.0')
    parser.add_argument('--cache-dir', type=Path, default=ROOT / 'output/windows-runtime')
    parser.add_argument('--stage-dir', type=Path)
    parser.add_argument('--vc-redist-dir', type=Path, help='A version folder inside the installed Visual Studio VC/Redist/MSVC tree')
    parser.add_argument('--stage-only', action='store_true')
    parser.add_argument('--archive-only', action='store_true')
    args = parser.parse_args()
    name = f'splendor-ai-windows-x64-v{args.version}'
    folder = args.stage_dir or ROOT / 'output/packages' / name
    if not args.archive_only:
        prepare(folder, args)
    if not args.stage_only:
        archive(folder, ROOT / 'dist' / (name + '.zip'))


if __name__ == '__main__':
    main()
