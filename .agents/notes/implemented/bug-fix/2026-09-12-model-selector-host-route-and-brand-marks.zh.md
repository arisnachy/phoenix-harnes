# Agent Note: Model selector owns one HARDNESS route and bundled provider marks

Status: implemented

[English](2026-09-12-model-selector-host-route-and-brand-marks.md) | 中文

## Problem

基础 Cordis 组合将 `@phoenix-ai/dsh-hardness-adapters` 作为 host capability 挂载，而 `standard` 和 `cordis` preset 将同一个包作为面向模型的适配器挂载。两个实例都会观察 `connection` 并注册 `/hardness`，因此 session 恢复会在模型选择运行前因重复前缀路由而失败。selector 还会从 CDN 获取 provider 标记，使 provider 身份依赖网络请求。

## Decision

`modelTools: false` 是 host adapter 的 ownership 信号。只有这个实例会安装 `installHardnessMissionRuntime` 并等待延迟提供的 host connection。`modelTools: true` 的 preset 实例注册自己的 `hardness_run` 工具和 protocol，但不注册 host RPC 路由。

model selector 为已识别的 provider 渲染打包的 SVG 路径。OpenAI 使用本地品牌路径；Gemini、OpenRouter、DeepSeek、Anthropic、Mistral、Meta、NVIDIA、Hugging Face、Ollama、Perplexity、Qwen、Kimi、Moonshot 和 Alibaba 使用打包的 Simple Icons 数据。未知 provider id 保留 monogram，不会触发猜测性的网络流量。

effort pane 继续渲染 host 提供的每个模型的精确 reasoning metadata，包括 description、default 和 provider-specific id。它将所选 effort 与 provider 和 model id 一起提交，而不是维护客户端自己的 effort 词表。

## Alternatives considered

**让所有 adapter 实例的 `/hardness` 注册都具备幂等性。** 拒绝：共享路由注册会掩盖 ownership 错误，并可能让一个 session disposer 删除另一个实例负责的 host 路由。

**保留 CDN 请求并改进 fallback。** 拒绝：provider 标记属于可以随 selector 一起发布的展示数据；网络依赖会为模型选择增加延迟和可避免的失败模式。

**为所有 provider 硬编码同一份 effort 列表。** 拒绝：reasoning 支持和 wire id 属于已解析的模型 adapter，固定列表会提供 provider 无法执行的控制，或丢弃受支持的等级。

## Consequences

无论挂载多少个完整 preset，host 只提供一个 `/hardness` 路由，同时每个 session 保留自己的面向模型工具。由于重复路由 ownership 不再发生，模型选择 session 恢复不会在 preset 挂载期间失败。

已知 provider 的标记可以离线工作，并在已发布的 client bundle 中保留原始 provider 路径。未知或自定义 provider 仍然可识别，而不会声称使用未支持的品牌。UI 不会请求 provider logo，也不会把 logo 失败当作模型操作错误。

## Testing

聚焦的 adapter 和 React 测试套件通过 14 个测试，包括仅 host 的路由注册、仅 session 的工具注册、Gemini/OpenAI/OpenRouter/DeepSeek 的打包标记，以及完整的 `low`/`medium`/`high`/`xhigh`/`max` effort 集合。仓库 build 通过 TypeScript host/client 编译、所有 package bundle 和 Vite frontend build。
