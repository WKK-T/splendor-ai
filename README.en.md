# Splendor AI

**A VibeCoding product developed with Codex.** A human defined the product, made design decisions and provided playtesting feedback; Codex implemented the game experience, model integration, tests and packaging. The rules engine builds on Adam Jones's MIT-licensed project.

A bright two-player Splendor game with geometric landscape cards, a draggable gem companion, on-device AI opponents and optional action hints. The game interface is in Chinese.

**[Play in your browser](https://wkk-t.github.io/splendor-ai/) · [Download v1.0.0](https://github.com/WKK-T/splendor-ai/releases/tag/v1.0.0) · [中文](README.md)**

![Game screenshot](docs/screenshot.png)

## Play

- **Browser:** use the link above, or unzip the browser download and open `index.html` in desktop Chrome or Edge. Everything is embedded and works offline after download.
- **Mac:** unzip the Apple Silicon package and open `启动游戏.command`. Requires macOS 14 or later. Python and models are bundled; leave the launcher terminal open while playing. The package is not code-signed, so macOS may require allowing it through its security settings after checking the download source.

The game implements two-player base rules: 90 development cards and 10 noble types. It includes token selection, purchases, reservations, gold payments, discards, noble choices, turn timers and action hints. Five original geometric gem companions offer two appearances, dragging, resizing and collapsing. No account, API key or paid inference service is needed.

## Opponents

| Opponent | Implementation | Browser | Mac |
| --- | --- | :---: | :---: |
| Simple bot | Greedy rules | ✓ | ✓ |
| AI easy | Transformer seed 422, 100M training checkpoint | ✓ | ✓ |
| AI medium | Transformer seed 422, 200M training checkpoint | ✓ | ✓ |
| AI hard | PV422 with 128 MCTS simulations | — | ✓ |
| AI hell | Same PV422 with 256 MCTS simulations | — | ✓ |

100M and 200M refer to training samples, **not parameter counts**. Each browser model has approximately 1.26 million parameters. The local PV policy/value pair has approximately 12.99 million parameters. Search budgets are simulation counts, not search depth; 256 simulations are not guaranteed to outperform 128 in every position. Difficulty labels are not calibrated human ratings.

Hints use the medium model in the browser. The local edition lets you select a hint model independently or turn hints off. Hints never execute moves for the player.

## Build

```sh
git clone https://github.com/WKK-T/splendor-ai.git
cd splendor-ai
python3 play/build.py
# Open play/index.html
```

The repository includes browser WASM, browser weights and artwork. For the local engine, use Python 3.12, install `local-models/four-level-20261018/requirements.txt`, run `python scripts/download_models.py`, build with `python play/build.py --local-game --output-dir local-game/web`, then launch `python local-game/server.py --open`.

See [model details](docs/models.md), [development instructions](docs/development.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Credits

Built with **Codex · VibeCoding**, with human direction and feedback. Based on [domdomegg/splendor](https://github.com/domdomegg/splendor) by Adam Jones. Upstream attribution is retained. Code is MIT-licensed; see [LICENSE](LICENSE) and asset/component notices.

This is an unofficial implementation, not affiliated with or endorsed by the owners of Splendor. Names and trademarks belong to their respective owners.
