"""Validate the real Windows ZIP after extracting it into a path with Chinese and spaces."""
from __future__ import annotations
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


class OtherService(BaseHTTPRequestHandler):
    """Occupy the default port, as another local application might do."""
    def do_GET(self):
        body = b'{"app":"another-application"}'
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'output/windows-validation')
    args = parser.parse_args()
    if sys.platform != 'win32':
        raise SystemExit('This test requires actual Windows; macOS structure checks do not substitute for it.')
    archive, output = args.archive.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    extracted = output / '中文 解压验证'
    if extracted.exists():
        raise SystemExit('Choose a fresh --output directory; an existing package is not overwritten.')
    extracted.mkdir()
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None, 'ZIP CRC mismatch'
        members = bundle.infolist()
        assert len({m.filename for m in members}) == len(members), 'Duplicate ZIP entries'
        for member in members:
            path = Path(member.filename)
            assert not path.is_absolute() and '..' not in path.parts and ':' not in member.filename
            assert not any(part in ('__pycache__', '.git') for part in path.parts)
        bundle.extractall(extracted)
    folders = [p for p in extracted.iterdir() if p.is_dir()]
    assert len(folders) == 1
    folder = folders[0]
    assert not list(folder.rglob('*.so')), 'Mac native extension must not be bundled for Windows'
    manifest = json.loads((folder / 'package-files.sha256.json').read_text(encoding='utf-8'))
    actual = {p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file()}
    assert actual == set(manifest) | {'package-files.sha256.json'}, 'Package file list mismatch'
    for name, expected in manifest.items():
        assert sha256(folder / name) == expected, 'SHA-256 mismatch: ' + name
    assert (folder / 'licenses/rust/manifest.json').is_file()
    python = folder / 'runtime/python.exe'
    env = os.environ.copy()
    env.update(PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1', SPLENDOR_NO_PAUSE='1')
    # Run from a directory outside the package to catch relative-path assumptions.
    check = subprocess.run([str(python), '-X', 'utf8', '-s', '-B', str(folder / 'app/server.py'), '--check'],
                           cwd=output, env=env, text=True, encoding='utf-8', capture_output=True, timeout=120)
    (output / 'startup-check.log').write_text(check.stdout + check.stderr, encoding='utf-8')
    assert check.returncode == 0, 'Bundled startup check failed; see startup-check.log'
    result = json.loads(check.stdout.strip().splitlines()[-1])
    assert result['passed'] is True
    subprocess.run([str(python), '-X', 'utf8', '-s', '-B', str(ROOT / 'tests/windows/runtime.py'),
                    str(folder), str(output / 'runtime.json')], cwd=output, env=env, check=True, timeout=300)
    blocker = ThreadingHTTPServer(('127.0.0.1', 8780), OtherService)
    threading.Thread(target=blocker.serve_forever, daemon=True).start()
    launch = folder / '启动游戏.bat'
    assert launch.is_file(), 'Chinese launch script missing'
    log = (output / 'launcher.log').open('w', encoding='utf-8')
    process = subprocess.Popen(f'cmd.exe /d /s /c ""{launch}""', cwd=output, env=env,
                               stdout=log, stderr=subprocess.STDOUT)
    origin = None
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError('Actual batch launcher exited before server became ready')
            for port in range(8781, 8800):
                try:
                    url = f'http://127.0.0.1:{port}'
                    with urllib.request.urlopen(url + '/api/health', timeout=.3) as response:
                        health = json.load(response)
                    if health.get('app') == 'splendor-local-game/1' and health.get('ready'):
                        origin = url
                        break
                except (OSError, ValueError, urllib.error.URLError):
                    pass
            if origin:
                break
            time.sleep(.2)
        assert origin, 'Package server did not become ready'
        port = int(origin.rsplit(':', 1)[1])
        bound = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command',
            f'Get-NetTCPConnection -State Listen -LocalPort {port} | Select-Object LocalAddress,OwningProcess | ConvertTo-Json -Compress'],
            text=True, encoding='utf-8')
        listeners = json.loads(bound)
        if isinstance(listeners, dict):
            listeners = [listeners]
        assert listeners and all(row['LocalAddress'] == '127.0.0.1' for row in listeners)
        subprocess.run(['node', str(ROOT / 'tests/windows/browser.cjs'), origin, str(output)],
                       cwd=ROOT, env=env, check=True, timeout=600)
        report = {'passed': True, 'windows_execution_performed': True,
            'archive_sha256': sha256(archive), 'archive_bytes': archive.stat().st_size,
            'manifest_files_verified': len(manifest), 'chinese_and_space_path': True,
            'actual_batch_launcher': True, 'port_conflict_fallback': port != 8780,
            'loopback_only': True, 'port': port,
            'runtime': json.loads((output / 'runtime.json').read_text(encoding='utf-8')),
            'browser': json.loads((output / 'browser.json').read_text(encoding='utf-8'))}
        (output / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({k: v for k, v in report.items() if k not in ('runtime', 'browser')}, ensure_ascii=False))
    finally:
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
        log.close()
        blocker.shutdown()
        blocker.server_close()


if __name__ == '__main__':
    main()
