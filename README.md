# 璀璨宝石 AI · Splendor AI

**由 Codex 完成的 VibeCoding 产品。** 从产品想法、交互打磨到模型接入、测试和打包，由人类提出需求并试玩反馈，Codex 负责开发实现。项目基于 Adam Jones 的 MIT 开源规则引擎构建，保留上游署名。

一个明亮、简洁的双人璀璨宝石游戏：几何风景卡面、可拖动的宝石小助手、本地运行的 AI 对手，以及按需显示的行动提示。

**[直接游玩](https://wkk-t.github.io/splendor-ai/) · [下载 v1.0.0](https://github.com/WKK-T/splendor-ai/releases/tag/v1.0.0) · [English](README.en.md)**

![游戏画面](docs/screenshot.png)

## 选择怎么玩

| 版本 | 使用方式 | 对手 |
| --- | --- | --- |
| 网页版 | 打开上方链接 | 简单机器人、AI 模型简单、AI 模型中等 |
| 离线网页版 | 下载浏览器压缩包，解压后双击 `index.html` | 同上；下载后无需网络 |
| Mac 本地版 | 下载 Apple Silicon 压缩包，解压后打开 `启动游戏.command` | 简单机器人 + 简单／中等／困难／地狱四档 AI |
| Windows 本地版 | [下载 x64 压缩包](https://github.com/WKK-T/splendor-ai/releases/download/v1.0.0/splendor-ai-windows-x64-v1.0.0.zip)，完整解压后双击 `启动游戏.bat` | 简单机器人 + 简单／中等／困难／地狱四档 AI |

浏览器版推荐桌面 Chrome 或 Edge。Mac 本地版适用于 Apple Silicon、macOS 14 及以上，自带 Python 和模型，无需安装开发工具；运行时保留启动终端窗口。未签名应用可能触发系统安全提示，可在核对下载来源后按系统提示允许打开。

Windows 本地版面向 Windows 10/11 的 Intel／AMD x64 电脑。建议解压到 `C:\Games\Splendor` 等较短目录，再打开启动脚本；支持中文和空格路径。它自带 Python、CPU 推理运行库与模型，无需安装 Python、CUDA 或取得管理员权限，下载后可离线使用。运行期间保留命令窗口。Windows 验收使用云端 Windows Server 2022／2025 环境，具体结果见 [验证记录](docs/validation.md)；尚未进行 Windows 10/11 实机测试。详见 [Windows 使用说明](docs/windows.md)。

## 已实现的玩法

- 双人基础规则，90 张发展卡、10 种贵族；拿取宝石、购买、预留、黄金支付、弃还与贵族选择。
- 简单机器人及神经网络对手，支持选择先后手、回合计时和重新开局。
- 点击宝石小助手获取当前行动建议；提示只建议，不替玩家落子。本地版的提示模型可独立选择或关闭。
- 五种原创几何宝石形象、两套造型，可拖动、缩放、收起。
- 70 幅几何风景插画；卡面分数、颜色与费用保持清晰。界面使用中文。
- 游戏和 AI 推理在自己的设备上运行，无需账号、API 密钥或付费推理服务。

## AI 难度

| 名称 | 实际使用的模型／策略 | 浏览器版 | Mac／Windows 本地版 |
| --- | --- | :---: | :---: |
| 简单机器人 | Greedy 规则策略 | ✓ | ✓ |
| AI 模型简单 | Transformer seed 422，100M 训练节点 | ✓ | ✓ |
| AI 模型中等 | Transformer seed 422，200M 训练节点 | ✓ | ✓ |
| AI 模型困难 | PV422，MCTS 128 次模拟 | — | ✓ |
| AI 模型地狱 | 同一 PV422，MCTS 256 次模拟 | — | ✓ |

**100M／200M 是训练采样量，不是参数量。** 两个浏览器模型各约 126 万参数。困难和地狱共享约 1,299 万参数的策略／价值网络，区别是搜索预算；256 次模拟不保证每个局面都优于 128 次。难度名称用于产品分档，不代表已校准的真人等级或固定胜率。

浏览器版的提示使用 200M 模型；本地版默认也使用中等模型，可在设置中独立选择简单／中等／困难／地狱提示，或关闭提示。选择地狱提示会使用 PV422 搜索 256 次，不会改变对手难度或自动替你行动。模型详情、哈希和使用边界见 [模型说明](docs/models.md)。

## 从源码运行

浏览器版的预编译规则 WASM、模型与插画已包含在仓库中，仅需 Python 3：

```sh
git clone https://github.com/WKK-T/splendor-ai.git
cd splendor-ai
python3 play/build.py
# 打开 play/index.html，或通过任意静态 HTTP 服务访问
```

本地四档 AI 需要 Python 3.12。模型文件作为独立 Release 附件提供，下载脚本会核对 SHA-256：

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r local-models/four-level-20261018/requirements.txt
python scripts/download_models.py
python play/build.py --local-game --output-dir local-game/web
python local-game/server.py --check
python local-game/server.py --open
```

本地服务只监听 `127.0.0.1`。完整启动、构建和测试说明见 [开发说明](docs/development.md)。

## 关于这个项目

这是由 **Codex 开发完成的 VibeCoding 游戏产品**，人类负责方向、取舍与试玩反馈。它使用已有开源成果，并非所有底层代码都从零编写。

- 规则引擎及初始实现来自 [domdomegg/splendor](https://github.com/domdomegg/splendor)，MIT，作者 Adam Jones。
- 本项目增加产品界面、插画、宝石小助手、模型接入、本地搜索服务和发布打包。
- 代码使用 [MIT License](LICENSE)。插画、模型和第三方组件的来源与许可范围见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目为非官方实现，与 Splendor／璀璨宝石的权利人无隶属或背书关系。游戏名称和商标属于各自权利人。
