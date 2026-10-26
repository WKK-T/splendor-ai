# 来源与许可

## 上游代码

本项目基于 **Adam Jones** 的 [domdomegg/splendor](https://github.com/domdomegg/splendor)，起始版本为 `426fa50e06fe99b40620131ca962f418824bb73a`。上游使用 MIT License；其版权声明完整保留在根目录 [LICENSE](LICENSE)。规则引擎、绑定和派生代码沿用该许可。

本项目新增的界面、推理适配、搜索集成、工具与文档由 Codex 根据人类需求开发，作为 **Codex VibeCoding 产品**发布。新增代码也使用 MIT License；此说明不替代任何第三方版权声明。

## 插画和图形

`play/assets/` 中用于游戏的 70 幅几何建筑风景插画由 OpenAI 图像生成工具根据本项目提示生成。公开版五种几何宝石小助手为本项目编写的 SVG 图形，不使用官方游戏画稿或动漫角色素材。项目贡献者以根目录 MIT 条款提供这些自有贡献中可授予的使用权；不声称拥有第三方商标或游戏名称。

## 模型

本项目发布的冻结模型由项目训练，来源和精确文件哈希见 [模型说明](docs/models.md) 及对应 manifest。浏览器 float32 导出和本地推理权重按根目录 MIT 条款分发。

## 运行时依赖

Rust / WebAssembly 组件使用 Cargo.lock 锁定依赖；对应的依赖许可原文与版本索引保存在 [`licenses/rust/`](licenses/rust/README.md)。Python 本地服务依赖 PyTorch、NumPy、Wasmtime 及其依赖。它们各自的许可保持有效。Mac 分发包保留 Python 运行时、Python packages 的 LICENSE／NOTICE／dist-info 信息和组件版本清单。根目录 MIT 不替代这些组件的许可。

## 名称

Splendor／璀璨宝石的名称、商标及相关第三方权利属于各自权利人。本项目是非官方实现，未得到这些权利人的认可或背书。

