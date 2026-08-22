# @deepseek-ai/dsh-phoenix

PHOENIX 是 DeepSeek Harness 的 profile bundle。它在标准 base profile 之后挂载 PHOENIX 自适应运行时，以及官方 Codex 与 Claude Code 子代理桥接。

该 bundle 不会因为模型来自 Codex、Claude Code 或新发现的 provider 就自动授予指挥权。PHOENIX 根据可验证能力进行排名，新模型保持 provisional，并在 DSH 原生能力接缝周围执行本地策略、ROI 与安全门控。

## Bundle 挂载内容

- `@deepseek-ai/dsh-phoenix-runtime`
- `@deepseek-ai/dsh-subagent-codex`
- `@deepseek-ai/dsh-subagent-claude-code`

运行时增加能力排名路由、有界跨 provider 故障转移、Token Flight Recorder、Agent ROI Gate、本地策略演进、隔离与 Mother Guard。

## Model Experience

该 bundle 默认不增加强制 prompt 文本。Codex 与 Claude Code 在现有 DSH 子代理层真正委派工作之前保持休眠。PHOENIX 尽可能使用确定性策略，因此空闲开销很小。

## Known Limitations and Deferred Work

首个 PHOENIX profile 尚未包含桌面应用、Repo Brain、Sandbox Farm 编排、Model Team Genome、自动 benchmark arena 或 collective observe-only transport。它刻意不提供任何 peer-to-peer 可执行演进路径。
