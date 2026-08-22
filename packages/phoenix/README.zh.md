# phoenix/ — PHOENIX 演进层

PHOENIX 是本仓库基于 DeepSeek Harness 的下游演进。此组中的包在复用 DSH 成熟能力接缝的同时，增加供应商无关的智能、安全、效率、连续性与本地自我改进。

| 包 | 作用 | ctx key |
|---|---|---|
| [`runtime/`](runtime/README.md) | 能力排名、自适应路由、故障转移、Token 记录、Agent ROI、本地演进、Mother Guard | `phoenix` |
| [`ai-bus/`](ai-bus/README.md) | provider 无关计算通道、免费路由策略、OrcaRouter/Ollama 预设 | `phoenixAiBus` |
| [`repo-brain/`](repo-brain/README.md) | 增量仓库地图、结构检索、反向 import 影响分析 | `phoenixRepoBrain` |

## 设计规则

优先复用现有 DSH 服务或 hook，而不是构建平行实现。只有在新实现有证据支持且仍能同步上游时，PHOENIX 才替换 DSH 组件。

成本、能力、权限、仓库知识、执行隔离与持久记忆保持为独立接缝。廉价模型不会自动获得信任；仓库索引不是 sandbox；观察结果也不是权限证据。
