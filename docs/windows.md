# Windows 本地版

[下载 Windows x64 离线包](https://github.com/WKK-T/splendor-ai/releases/download/v1.0.0/splendor-ai-windows-x64-v1.0.0.zip) · [完整发布页与校验文件](https://github.com/WKK-T/splendor-ai/releases/tag/v1.0.0)

这是由 **Codex 完成的 VibeCoding 游戏产品**。Windows 包包含游戏、Python、CPU 推理运行库和全部三个模型；无需安装 Python、CUDA 或开发工具，无需管理员权限、账号或 API 密钥。下载完成后可以离线对局。

## 启动游戏

1. 将 ZIP **完整解压**到普通目录，建议使用 `C:\Games\Splendor` 等较短路径。文件夹名可以包含中文或空格；不要在压缩包预览窗口中直接运行。
2. 双击 **`启动游戏.bat`**。也可以使用同样功能的 `Start Splendor.bat`。
3. 等待浏览器自动打开，保留命令窗口。若浏览器没有打开，复制窗口中的 `http://127.0.0.1:...` 地址到 Edge 或 Chrome。
4. 结束时关闭命令窗口，或在其中按 `Ctrl+C`，本地服务随即停止。

请保留整个解压文件夹。单独发送启动脚本或 `app/web/index.html` 无法运行本地 AI。服务只监听本机回环地址，不需要公网服务器或局域网端口配置。

## 对手和提示

| 选项 | 使用的策略 |
| --- | --- |
| 简单机器人 | Greedy 规则策略 |
| AI 模型简单 | 原版 Transformer seed 422，100M 训练节点 |
| AI 模型中等 | 原版 Transformer seed 422，200M 训练节点 |
| AI 模型困难 | PV422，MCTS 128 次模拟 |
| AI 模型地狱 | 同一 PV422，MCTS 256 次模拟 |

100M／200M 指训练采样量，不是模型参数量。困难和地狱共享权重，区别是搜索预算；更多搜索不保证在每个局面都更强。

在“设置”中可以独立选择提示模型，也可以关闭提示。例如，对手使用简单档时，仍可选择**地狱提示**，让 PV422 搜索 256 次后给出建议。点击宝石伙伴，再点击“提示”即可查看；这不会替你行动，也不会改变对手难度。提示默认使用中等模型。

## 平台和验证范围

此包面向 Windows 10/11 的 **Intel／AMD x64** 电脑，不适用于 32 位 Windows 或 Windows ARM。无需 NVIDIA 显卡，推理使用 CPU。

Windows 发布流程在带 Visual Studio 2026 的云端环境构建，再将同一份 ZIP 交给 **Windows Server 2022 和 Windows Server 2025** 环境验证。验证使用包内 Python，涵盖文件完整性、中文与空格目录、实际启动脚本、四档推理、搜索次数及浏览器交互；结果以 [发布验证记录](validation.md) 为准。**尚未进行 Windows 10/11 实机测试**，不能将 Server 验证视作所有个人电脑的兼容性保证。

## 无法启动时

- **点击后窗口立即消失或显示错误：**确认已经完整解压，且 `runtime/python.exe`、`app/server.py` 和模型文件仍在原目录关系中。将整个文件夹移到较短路径后重试。
- **浏览器未自动打开：**保留命令窗口，将其中显示的本机地址复制到 Edge／Chrome。启动器会在默认端口被占用时寻找其他空闲端口。
- **模型正在思考：**首次加载模型会多用一些时间；困难和地狱的搜索计算也比简单／中等更多。等待当前计算完成即可。
- **系统提示来源未知：**分发包未做代码签名，请核对 GitHub 发布来源和 `SHA256SUMS.txt`。不需要关闭系统安全防护。

可在解压目录打开命令提示符，运行随包检查：

```bat
runtime\python.exe -X utf8 -B app\server.py --check
```

反馈问题时请附上错误文字、系统版本、CPU 型号和游戏版本；不要附带账户凭据或无关个人文件。

运行时来源见 `windows-runtime-lock.json` 和 `runtime-components.json`，每个发布文件的 SHA-256 见 `package-files.sha256.json`。第三方组件保留其原始许可；Microsoft REDIST 文件的来源、版本和适用条款位于 `licenses/microsoft`。
