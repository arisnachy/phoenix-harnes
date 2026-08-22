# @deepseek-ai/dsh-phoenix

PHOENIX 是 DeepSeek Harness 的 profile bundle。它在标准 base profile 之后挂载自适应 runtime、成本感知 AI Bus、零模型调用 Repo Brain，以及官方 Codex 与 Claude Code 子代理桥接。

该 bundle 不会因为模型来自 Codex、Claude Code、OrcaRouter、Ollama 或任何新 provider 就自动授予指挥权。PHOENIX 将成本、能力与权限分开；Capability Ladder 仍然是信任闸门。

## Bundle 挂载内容

- `@deepseek-ai/dsh-phoenix-ai-bus`
- `@deepseek-ai/dsh-phoenix-repo-brain`
- `@deepseek-ai/dsh-phoenix-runtime`
- `@deepseek-ai/dsh-subagent-codex`
- `@deepseek-ai/dsh-subagent-claude-code`

bundle 还通过现有的 `@deepseek-ai/dsh-llm-pi-ai` 接缝配置显式 `orcarouter/free` 路由。凭据只通过 `ORCAROUTER_API_KEY` 引用，不存储在源码中。

Runtime 提供能力排名路由、有界跨 provider 故障转移、Token Flight Recorder、Agent ROI Gate、本地策略演进、隔离与 Mother Guard。AI Bus 只分类成本通道，不授予信任。Repo Brain 提供确定性仓库检索与反向依赖影响分析，索引和搜索本身不调用模型。

## Model Experience

### PHOENIX composition

#### What the model sees

bundle 本身不增加独立提示文本。模型可见内容由挂载的子包拥有：Repo Brain 拥有仓库提示和工具，子代理包拥有各自的模型可见契约。

#### Token effect

通过子包间接产生。AI Bus 直接上下文开销为零；Repo Brain 贡献其文档定义的提示/工具表面；子代理桥接只在可达时产生所属包定义的影响。

#### KV Cache effect

bundle 是组合载体。改变 bundle 组合可能改变稳定请求前缀或可用工具 schema，因此可能影响 cache 复用。

## Known Limitations and Deferred Work

v13 profile 尚未包含 Sandbox Farm 编排、Memory Genome/Rebirth、Model Team Genome、自动 benchmark arena、MCP Hibernate/Toolsmith、桌面 Flight Deck 或 collective observe-only transport。它刻意不提供 peer-to-peer 可执行演进路径，也不会静默启用付费 provider fallback。
