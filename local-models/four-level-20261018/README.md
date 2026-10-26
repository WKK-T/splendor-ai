# 冻结推理模型

此目录是已集成本地游戏的推理包。`manifest.json` 记录权重、参数量、搜索预算与文件校验值。权重由仓库根目录的 `scripts/download_models.py` 获取。

- `s422-100M.pt`：原版 Transformer seed 422，100M 行动节点。
- `s422-200M.pt`：原版 Transformer seed 422，200M 行动节点，同时用于搜索中的对手行为模型。
- `PV422-inference.pt`：PV422 最终 2048 对局节点，独立策略网络和价值网络。困难与地狱共用此文件。

价值温度固定为 `1.3740903342345823`。网络概率、价值输出与搜索分数均不是面向真实玩家校准的获胜概率。强制唯一动作直接返回，终局按规则结算；一般搜索使用玩家可见信息抽样构建假设局面。

## API

在此目录运行：

```sh
python3 -m splendor_local verify
python3 -m splendor_local profiles
python3 -m splendor_local infer examples/base-observation.json --profile hard
python3 -m splendor_local jsonl
```

Python 接口：

```python
from splendor_local import Runtime
runtime = Runtime()
result = runtime.infer(observation, profile="hard", seed=42)
```

`Runtime` 缓存已加载模型，并串行处理推理。`LocalSession` 分别保存对手档位与提示档位。完整公开已购卡身份是输入要求；未知字段、私有牌库、错误合法动作表会被拒绝。

`acceptance.py` 检验模型结构、函数等价迁移、公开信息边界、贵族动作映射、搜索预算、缓存会话和独立提示设置。测试生成的 `evidence/` 不属于发布源代码。
