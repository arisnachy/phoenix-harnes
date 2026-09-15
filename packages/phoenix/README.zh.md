# phoenix/ — PHOENIX 演进层

PHOENIX 是本仓库基于 DeepSeek Harness 的下游演进。此组中的包在复用 DSH 成熟能力接缝的同时，增加供应商无关的智能、安全、效率、连续性与本地自我改进。

| 包 | 作用 | ctx key |
|---|---|---|
| [`runtime/`](runtime/README.md) | 能力排名、自适应路由、故障转移、Token 记录、Agent ROI、本地演进、Mother Guard | `phoenix` |

## 设计规则

优先复用现有 DSH 服务或 hook，而不是构建平行实现。只有在新实现有证据支持且仍能同步上游时，PHOENIX 才替换 DSH 组件。
