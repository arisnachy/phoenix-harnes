# PHOENIX Runtime

`@deepseek-ai/dsh-phoenix-runtime` 是 DeepSeek Harness 树中的首个原生 PHOENIX 智能层。它复用 DSH 的 agent loop、LLM registry、token meter、tools pipeline、sandbox seam、durable sessions、compaction、jobs 与 subagents，而不是复制这些能力。

## 它增加什么

- **Model Capability Ladder**：按 planning、orchestration、reasoning、coding、debugging、research、tool use、critique、judging、security、reliability、efficiency 分角色排名。
- **能力不等于权限**：新发现模型是 provisional；provisional 或 quarantined 模型不会赢得 PHOENIX 路由。Orchestrator 与 judge 需要更高门槛。
- **自动 onboarding**：`ctx.llm` 公布的模型先以 provisional 进入，不需要付费调用。
- **角色路由**：零 token 的确定性分类器选择角色，`agent/request` 可路由到该角色证据最强的 qualified 模型。
- **Never-Stop failover**：DSH 原生 provider retry 先处理；若其拒绝重试，PHOENIX 可在有界预算内切换到另一个 independently qualified provider/model。
- **Token Flight Recorder**：记录原生 `ctx.tokenMeter` 的上下文压力与 surface size。
- **Agent ROI Gate**：简单查找任务不自动启动额外模型进程。
- **本地演进**：benchmark/operator 证据与 quarantine 状态仅保存在 `$DSH_HOME/phoenix/local-evolution.json`。真实任务可调整 reliability，但不能单独授予 orchestration/judging 权限。
- **Mother Guard**：单调工具 guard 拒绝 force-push、关键安全/control-plane 直接修改模式与 peer-supplied executable evolution。

## Safety invariants

PHOENIX 不把 provider 名、模型名、流行度或 frontier 标签视作权限。角色权限必须来自证据。Collective evolution 保持 observe-only；本运行时没有 peer execution transport。本地演进修改策略证据，不修改源代码。

该运行时不声称自己是 OS sandbox。DSH sandbox packages 仍是隔离接缝。它也不声称在 compaction 中保存模型隐藏推理；DSH durable log/compaction 仍是连续性的事实来源。

## Model Experience

### Runtime policy layer

#### What the model sees

模型不会直接看到新的强制提示文本。PHOENIX Runtime 默认不把策略状态暴露给模型，而是在现有 DSH request、tool 与 subagent 接缝周围执行策略。

#### Token effect

未显式请求可观测性表面时，直接请求上下文开销为零。路由与 ROI 决策是确定性策略，不需要额外模型调用。

#### KV Cache effect

Runtime 本身不改写 prompt 前缀，因此保持组合后的 DSH 请求已有的可复用前缀。若策略切换到不同模型/provider，则不假设可跨模型复用 cache。

## Known Limitations and Deferred Work

- **自动证据** — Genesis 尚无自动质量 benchmark arena；资格证据仍来自显式 benchmark/operator 记录。
- **团队智能** — 尚无 Model Team Genome。
- **Collective evolution** — 尚无分布式 Evolution Mesh transport，并明确拒绝 peer-supplied executable evolution。
- **仓库认知** — Repo Brain 留给独立 PHOENIX 层。
- **桌面表面** — Genesis 不包含 Windows PHOENIX desktop shell/Flight Deck。
