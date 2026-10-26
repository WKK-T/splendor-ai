"""Same Rust SearchCore in WebAssembly for Windows and portable validation."""
import json
from pathlib import Path
from functools import lru_cache
import wasmtime

ROOT = Path(__file__).resolve().parent


def static_data_json():
    return (ROOT/'static.json').read_text()


@lru_cache(maxsize=1)
def compiled():
    engine = wasmtime.Engine()
    return engine, wasmtime.Module.from_file(engine, str(ROOT/'search.wasm'))


class Search:
    def __init__(self, observation_json, budget, seed, cpuct=1.5, max_decisions=128):
        engine, module = compiled()
        self.store = wasmtime.Store(engine)
        instance = wasmtime.Instance(self.store, module, [])
        self.exports = instance.exports(self.store)
        self.memory = self.exports['memory']
        self._call('new', observation=observation_json, budget=budget, seed=seed,
                   cpuct=cpuct, max_decisions=max_decisions)

    def _call(self, command, **kwargs):
        data = json.dumps({'command':command, **kwargs}, separators=(',', ':'), allow_nan=False).encode()
        ptr = self.exports['alloc'](self.store, len(data))
        try:
            self.memory.write(self.store, data, ptr)
            self.exports['call'](self.store, ptr, len(data))
            out = self.exports['response_ptr'](self.store)
            n = self.exports['response_len'](self.store)
            response = json.loads(bytes(self.memory.read(self.store, out, out+n)))
        finally:
            self.exports['dealloc'](self.store, ptr, len(data))
        if not response['ok']:
            raise ValueError(response['error'])
        return response['value']

    def requests(self):
        return self._call('requests')

    def done(self):
        return self._call('done')

    def submit(self, request_id, priors, value):
        self._call('submit', id=request_id, priors=priors, value=value)

    def result_json(self):
        return json.dumps(self._call('result'), separators=(',', ':'))
