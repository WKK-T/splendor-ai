# Microsoft 运行组件许可来源

Windows 包的额外 C++ 运行组件来自构建机器中已安装的 Visual Studio `VC/Redist/MSVC` 目录。打包器记录实际 Visual Studio 产品、版本、相对来源路径和每个未修改 DLL 的 SHA-256；不从系统目录或独立终端用户安装程序中猜测复制。

- `vs2022-*` 和 `vs2026-*` 分别对应 Visual Studio 2022 与 2026 的 Enterprise / Professional 许可原文及官方 REDIST 清单。构建时只选择实际工具链对应的年份。
- `vc-runtime-license-reference.docx` 是运行组件的终端使用许可参考，**不作为再分发权的来源**。该文件与 Visual Studio 的分发条款有不同用途。
- `sources.json` 保存官方地址、下载时间和文件哈希。DOCX 未改动；官方 REDIST 页面也按原字节保存，文件扩展名为 `.html.txt`，避免离线查看时执行页面脚本。

Microsoft 文件保持原许可，项目的 MIT License 不替代它们。允许分发的目录及例外以所附官方清单为准；`debug_nonredist` 内容不进入发布包。

官方入口：[Visual Studio 许可目录](https://visualstudio.microsoft.com/license-terms/)、[2022 REDIST 清单](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution)、[2026 REDIST 清单](https://learn.microsoft.com/en-us/visualstudio/releases/2026/redistribution)。
