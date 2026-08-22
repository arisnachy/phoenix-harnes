# @arisnachy/phoenix-bundle

[English](README.md) | 中文

PHOENIX 是 DeepSeek Harness 的 profile bundle。它在标准 base profile 之后挂载 PHOENIX 自适应 runtime，以及官方 Codex 与 Claude Code 子代理桥接。

该 bundle 不会因为模型来自 Codex、Claude Code 或任何新 provider 就自动授予指挥权。PHOENIX 根据可验证能力进行排名，新模型保持 provisional，并在 DSH 原生能力接缝周围执行本地策略、ROI 与安全门控。

## Bundle 挂载内容

- `@arisnachy/phoenix-runtime`
- `@deepseek-ai/dsh-subagent-codex`
- `@deepseek-ai/dsh-subagent-claude-code`

Runtime 增加能力排名路由、有界跨 provider 故障转移、Token Flight Recorder、Agent ROI Gate、本地策略演进、隔离与 Mother Guard。

## Model Experience

### PHOENIX Genesis composition

#### What the model sees

bundle 本身不增加独立 prompt 文本。它的 `cordis.patch.yml` 负责组合子包；模型可见行为由这些子包拥有，而 PHOENIX Runtime 默认不增加强制提示文本。

#### Token effect

通过子包间接产生。bundle 载体自身直接请求 token 开销为零；PHOENIX Runtime 的确定性 routing/ROI 策略不需要额外模型请求。

#### KV Cache effect

bundle 是组合载体。自身 patch-list 不增加请求文本，但改变挂载包集合可能改变组合请求前缀或工具表面，因此可能影响 cache 复用。

## Known Limitations and Deferred Work

- **仓库认知** — Genesis 尚不包含 Repo Brain。
- **并行执行** — Sandbox Farm 编排尚未加入。
- **模型团队** — Model Team Genome 与自动 benchmark arena 尚未加入。
- **桌面表面** — Windows PHOENIX 应用/Flight Deck 尚未加入。
- **Collective evolution** — 尚无 collective observe-only transport，并明确不提供 peer-to-peer executable evolution。
