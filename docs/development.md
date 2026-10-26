# 构建与验证

## 仓库结构

```text
crates/                     Rust 基础规则与 Python / WebAssembly 绑定
play/                       单文件浏览器游戏、插画、浏览器权重与测试
local-game/                 本地 HTTP 服务、浏览器适配与便携搜索核心
local-models/four-level-20261018/
                            冻结的四档推理接口、manifest 与验收测试
scripts/                    模型下载和发布打包工具
licenses/                   编译依赖的许可原文
```

## 浏览器版

需要 Python 3.10 及以上。预编译 WASM 和两个浏览器权重已随源码提供：

```sh
python3 play/build.py
```

生成 `play/index.html`，可直接用桌面 Chrome / Edge 打开，不需要服务端或网络。不要直接打开 `play/template.html`，它是构建模板。

规则核心测试：

```sh
cargo test -p splendor-core
```

浏览器回归测试需要 Node.js 和 Playwright：

```sh
npm install --no-save playwright
npx playwright install chromium
node play/tests/browser.cjs
```

已有 Chrome 时可以设置 `CHROME_PATH`。测试覆盖离线启动、双方先后手的完整对局、合法行动、提示、取消、形象切换以及浏览器异常。

如需重编译规则 WASM，先安装 Rust `wasm32-unknown-unknown` target 和 `wasm-bindgen-cli` 0.2.100，按 [play/README.md](../play/README.md) 操作。发布构建应使用 Rust 的 `--remap-path-prefix` 去掉构建机器目录信息。

## 本地四档 AI

Mac Apple Silicon 已验证。使用 Python 3.12 创建虚拟环境，然后：

```sh
python -m pip install -r local-models/four-level-20261018/requirements.txt
python scripts/download_models.py
python play/build.py --local-game --output-dir local-game/web
python local-game/server.py --check
python local-game/server.py --open
```

模型下载器仅接受 manifest 列出的文件，验证文件大小和 SHA-256 后安装。已有模型包可运行：

```sh
python scripts/download_models.py --archive /path/to/splendor-ai-models-v1.0.0.zip
```

本地服务只监听回环地址，默认从 8780 端口起寻找可用端口；通过浏览器访问控制推理。界面不能作为独立静态文件运行，因为困难／地狱使用本地 Python 推理服务。离线网页版和本地网页版的输出目录彼此分开。

验证模型身份、观察信息边界、搜索、取消与 HTTP 适配：

```sh
python local-models/four-level-20261018/acceptance.py
python local-game/verify.py
```

验收中的搜索次数与权重哈希用于检查接线正确，不用于声称模型具备某个人类水平。

## 发布产物

- `splendor-ai-browser-v1.0.0.zip`：单文件网页、说明与许可。
- `splendor-ai-macos-arm64-v1.0.0.zip`：本地游戏、三个权重、Python 运行环境、许可和启动脚本。
- `splendor-ai-models-v1.0.0.zip`：仅用于源码运行的三个冻结权重及许可。
- `SHA256SUMS.txt`：发布附件校验。

源码本身不包含 `.pt` 文件或 Python 运行时。使用下载器获取模型，或直接使用整合包。分发前运行对应平台的检查并保留依赖许可；不要把构建缓存、个人配置或机器目录信息带入产物。
