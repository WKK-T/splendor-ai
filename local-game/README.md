# 本地游戏

本地版沿用浏览器牌桌，在本机 Python 进程中运行三个模型，提供四档 AI 和独立的提示选择。服务仅监听 `127.0.0.1`。客户端发送当前玩家可见局面与合法动作表，不发送牌库顺序或对手隐藏牌。

从仓库根目录运行：

```sh
python3 scripts/download_models.py
python3 -m pip install -r local-models/four-level-20261018/requirements.txt
python3 play/build.py --local-game --output-dir local-game/web
python3 local-game/server.py --check
python3 local-game/server.py --open
```

预编译本地扩展适用于 Apple Silicon Mac 和 Python 3.12；发布压缩包已携带运行环境。浏览器会打开本机地址，终端关闭后服务停止。

## 模型与提示

| 界面选项 | 权重 | 搜索模拟次数 |
|---|---|---:|
| 简单机器人 | Greedy 规则策略 | 0 |
| AI 模型简单 | 原版 Transformer，seed 422，100M 训练行动 | 0 |
| AI 模型中等 | 原版 Transformer，seed 422，200M 训练行动 | 0 |
| AI 模型困难 | PV422 | 128 |
| AI 模型地狱 | 同一 PV422 | 256 |

`100M/200M` 是训练行动数，不是模型参数量。搜索次数表示每步预算，不是搜索深度或胜率。提示可选择四档模型之一或关闭；该选择与对手独立。

## 检查与打包

```sh
python3 local-game/verify.py
python3 local-models/four-level-20261018/acceptance.py
python3 scripts/build_local_package.py --version 1.0.0
```

打包器要求可搬移的 macOS arm64 Python 3.12 运行环境，也可用 `--runtime-dir` 指定已备好的运行环境，用 `--runtime-manifest` 指定其组件清单。`--stage-only` 准备目录；验证后 `--archive-only` 生成 ZIP 与 SHA-256 文件。第三方许可证完整保留。

`native-portable` 将同一 Rust 搜索核心封装为 WebAssembly；`verify.py` 比较其请求、结果及四档模型输出与本地扩展的一致性。

重建本地和可移植搜索二进制：先安装 Rust stable 和 `wasm32-unknown-unknown` 编译目标，再用当前 Python 环境运行 `python3 local-game/rebuild_search.py`。脚本清除构建路径中的个人目录，更新二进制 SHA-256 清单；不会修改权重。重建后请重新运行上述验证。
