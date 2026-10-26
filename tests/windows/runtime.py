"""Executed by the extracted package's Python, never a developer Python."""
from pathlib import Path
import json
import platform
import sys


def loaded_runtime_paths(folder):
    """Observe existing modules after inference; never preload a CRT DLL."""
    import ctypes
    from ctypes import wintypes
    import numpy
    import torch
    import wasmtime
    runtime_dir = (folder / 'runtime').resolve()
    packages = {}
    for name, module in [('torch', torch), ('numpy', numpy), ('wasmtime', wasmtime)]:
        location = Path(module.__file__).resolve()
        location.relative_to(runtime_dir)
        packages[name] = str(location)
    lock_path = Path(__file__).resolve().parents[2] / 'scripts/windows-runtime-lock.json'
    lock = json.loads(lock_path.read_text(encoding='utf-8'))
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel.GetModuleHandleW.restype = wintypes.HMODULE
    kernel.GetModuleFileNameW.argtypes = [wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    kernel.GetModuleFileNameW.restype = wintypes.DWORD
    loaded = {}
    for name in lock['vc_runtime']['required_dlls']:
        handle = kernel.GetModuleHandleW(name)
        if not handle:
            loaded[name] = {'status': 'not_loaded', 'path': None}
            continue
        buffer = ctypes.create_unicode_buffer(32768)
        length = kernel.GetModuleFileNameW(handle, buffer, len(buffer))
        if not length:
            raise ctypes.WinError(ctypes.get_last_error())
        assert length < len(buffer), 'Loaded module path was truncated'
        location = Path(buffer.value).resolve()
        # A preinstalled system or Visual Studio CRT must not conceal a missing package file.
        location.relative_to(runtime_dir)
        loaded[name] = {'status': 'loaded_from_package', 'path': str(location)}
    for name in ('vcruntime140.dll', 'msvcp140.dll'):
        assert loaded[name]['status'] == 'loaded_from_package', name + ' was not observed after inference'
    return {'python_packages': packages, 'vc_runtime_dlls': loaded}


def exclusive_listener(folder):
    """Verify the packaged server itself protects its socket against reuse."""
    import socket
    sys.path.insert(0, str(folder / 'app'))
    import server
    http = server.LocalHTTPServer(('127.0.0.1', 0), server.Handler)
    try:
        options = {'exclusive_addruse': http.socket.getsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE),
                   'reuse_addr': http.socket.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR)}
        assert options == {'exclusive_addruse': 1, 'reuse_addr': 0}, options
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('127.0.0.1', http.server_port))
            except OSError as exc:
                assert exc.winerror in (10013, 10048), exc
            else:
                raise AssertionError('A second socket was able to reuse the game port')
        return {**options, 'second_bind_rejected': True}
    finally:
        http.server_close()


def main():
    folder = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    assert sys.platform == 'win32', 'Actual Windows execution is required'
    assert platform.machine().lower() in ('amd64', 'x86_64')
    assert Path(sys.executable).resolve() == (folder / 'runtime/python.exe').resolve()
    sys.path.insert(0, str(folder / 'app/models'))
    from splendor_local import Runtime, verify_package
    from splendor_local.observation import engine
    assert engine.Search.__module__.endswith('.portable'), 'Windows must use the portable search engine'
    verified = verify_package()
    observation = json.loads((folder / 'app/models/examples/base-observation.json').read_text(encoding='utf-8'))
    runtime = Runtime()
    profiles = []
    for name, model, budget in [('easy', 's422-100M', 0), ('medium', 's422-200M', 0),
                                 ('hard', 'PV422', 128), ('hell', 'PV422', 256)]:
        result = runtime.infer(observation, name, seed=42)
        assert result['model'] == model and result['simulations'] == budget
        assert result['legal_mask'][result['action_index']]
        assert not result['forced'], 'The fixture must exercise real neural inference'
        profiles.append({key: result[key] for key in ['profile', 'model', 'action_index', 'simulations', 'wall_seconds']})
    loaded = loaded_runtime_paths(folder)
    listener = exclusive_listener(folder)
    try:
        runtime.infer(observation, 'hell', cancelled=lambda: True)
    except InterruptedError:
        pass
    else:
        raise AssertionError('Cancelled inference was not stopped')
    bad = dict(observation, decks=[[], [], []])
    try:
        runtime.infer(bad, 'easy')
    except ValueError:
        pass
    else:
        raise AssertionError('Private deck information was accepted')
    output.write_text(json.dumps({'passed': True, 'windows_execution_performed': True,
        'python': sys.version.split()[0], 'platform': platform.platform(),
        'package_files_verified': len(verified['files']), 'profiles': profiles,
        'loaded_runtime_paths': loaded,
        'exclusive_listener': listener,
        'portable_search': True, 'cancelled_inference_rejected': True,
        'private_observation_rejected': True}, indent=2) + '\n', encoding='utf-8')
    print('Bundled Windows Python: all four profiles, integrity and cancellation passed')


if __name__ == '__main__':
    main()
