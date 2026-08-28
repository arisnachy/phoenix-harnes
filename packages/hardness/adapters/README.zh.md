# `@deepseek-ai/dsh-hardness-adapters`

[English](README.md) | 中文

将 PHOENIX 现有 tools 与 skills 的 metadata 投影到 HARDNESS Tool Atlas。

适配器不会执行 tools、加载 skill 正文或授予权限；每个源 registry 仍保留其 authority。

## Model Experience

### 投影的 capability metadata

#### What the model sees

消费者可以向模型暴露稳定 capability 标识，例如 `tool:<name>`、`skill:<name>` 与 `openclaw:<id>`，以及 compatibility 和验证状态；执行仍由 PHOENIX approval 与规范 registry 控制。

当规范的 system-prompt service 已挂载时，此 package 会安装 `hardness:operating-protocol` section。它为每个模型提供相同的生命周期词汇，并要求在把任务描述为完成之前经过 resolution、approval、verification、presentation 和 evidence。

Tool projection 可以订阅 `tools/change`；这样动态连接的 tool（包括 MCP tool）会保持在 HARDNESS 中，同时注册仍可撤销。内部 `hardness_run` tool 会被排除，避免递归路由。

每个 live mission 都会向调用方 session 追加无 secret 的 `hardness/mission` trace。trace 记录 protocol 的 terminal state、capability identity、artifact/evidence 引用和稳定 reason code；`replayHardnessMissionAudit` 可以在不重放 arguments、credentials 或 provider error text 的情况下重建一次调用。

#### Token effect

protocol section 和 capability metadata 会增加模型 token；单纯索引源 registry 不会增加 prompt 文本。

#### KV Cache effect

只要源 schema、extension metadata 与验证状态保持不变，投影 catalog 就保持良好的 KV cache 复用特性。

## Known Limitations and Deferred Work

- 外部 extension 执行继续由 Capability Broker 与隔离 package-host contract 管理，不会在启动时被 eager activate。
- 持久化 mission trace 需要 live agent session；没有 session 的直接 runner 单元调用不会记录，也不能作为 production proof。
