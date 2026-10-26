# Browser game

Build with Python 3.10+ from the repository root:

```sh
python3 play/build.py
```

Open `play/index.html` in Chrome or Edge. The generated file includes the rule engine, all artwork, both policies and their workers. It makes no network requests and also works via `file://`.

The simple robot is the default. The two AI opponents use the original Transformer seed 422 after 100M and 200M training samples. Hints independently use 200M. The models have approximately 1.26 million parameters each; 100M/200M refer to training samples, not parameter counts.

To build the four-level local interface (served by the local Python runtime):

```sh
python3 play/build.py --local-game --output-dir local-game/web
```

Model identities and hashes are frozen in `model-release.json`, with matching browser metadata beside each weight file. The build verifies the hashes before embedding them.

## Browser regression test

Install Playwright and its Chromium browser, then run:

```sh
npm install --no-save playwright
npx playwright install chromium
node play/tests/browser.cjs
```

Alternatively set `CHROME_PATH` to an installed Chrome executable. The test opens the standalone file in offline mode, completes six games with both starting seats, exercises payment/discard/noble phases, checks hints and cancellation, switches all companion styles, and rejects network requests and browser errors. Results are written under `output/browser-validation/`.

## Rule engine

The checked-in WASM is built from `crates/splendor-wasm`. To rebuild it, install `wasm-bindgen-cli` version 0.2.100 and the `wasm32-unknown-unknown` Rust target, then run:

```sh
RUSTFLAGS="--remap-path-prefix=$HOME=/build" cargo build --locked --release --target wasm32-unknown-unknown -p splendor-wasm
wasm-bindgen --target no-modules --out-dir crates/splendor-wasm/pkg target/wasm32-unknown-unknown/release/splendor_wasm.wasm
cargo test -p splendor-core
```
