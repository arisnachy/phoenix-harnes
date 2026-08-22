# PHOENIX 配置

[English](phoenix-profile.md) | 中文

此内置配置层与 base 和 web bundle 组合；不会分叉 Agent loop，也不会复制提供商适配器。其 patch 和路由器随 CLI 包一起发布，因此公开 CLI 不依赖私有下游包。

它通过 `@deepseek-ai/dsh-llm-pi-ai` 声明两条路由：

- 本地 Ollama OpenAI 兼容端点上的 `phoenix-local/qwen3:8b`。
- OrcaRouter 上由 `ORCAROUTER_API_KEY` 认证的 `phoenix-free/orcarouter/free`。

随后它从同一个 CLI 包挂载 `@deepseek-ai/dsh/phoenix-router`，并选择内置 `phoenix` Agent 预设。配置中有意不提供 `orcarouter/auto` 路由，也不进行故障时的提供商回退。

## 模型体验

### PHOENIX 路由组合

#### 模型看到的内容

所选模型会收到 PHOENIX 预设 persona，其中 `{{model}}` 被替换为该模型自己的 id。日常任务到达 `qwen3:8b`；提升后的任务到达 `orcarouter/free`。用户提供的 `[phoenix:local]` 和 `[phoenix:free]` 会保留在用户文本中。

#### Token 影响

bundle 只添加所选预设本来就拥有的 PHOENIX persona 文本。路由元数据不会添加消息。强制前缀只消耗用户消息中本来就存在的 token。

#### KV Cache 影响

切换通道必然选择不同的提供商/模型缓存。在同一通道内，bundle 提供稳定的 persona 文本且不添加逐请求路由后缀，因此不会引入额外的前缀抖动。

## 已知限制与延后工作

- 首次使用前，请安装 Ollama、执行 `ollama pull qwen3:8b`，并保持本地服务监听 `127.0.0.1:11434`。
- 免费通道需要 `ORCAROUTER_API_KEY`，并受 OrcaRouter 可用免费配额和模型可用性的限制。
- 此基础尚未实现 PHOENIX 记忆、receipts、Forge Chamber、Evolution Mesh、HealthIA packs 或语义路由。
- 内置的上下文和输出声明是保守的适配器元数据，不保证动态选中的每个上游免费模型都提供完整容量。
