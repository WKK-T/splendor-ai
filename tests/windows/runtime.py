"""Executed by the extracted package's Python, never a developer Python."""
from pathlib import Path
import json
import platform
import sys


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
        'portable_search': True, 'cancelled_inference_rejected': True,
        'private_observation_rejected': True}, indent=2) + '\n', encoding='utf-8')
    print('Bundled Windows Python: all four profiles, integrity and cancellation passed')


if __name__ == '__main__':
    main()
