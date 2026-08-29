# `@deepseek-ai/dsh-hardness-adapters`

[English](README.md) | 中文

将 PHOENIX 现有 tools 与 skills 的 metadata 投影到 HARDNESS Tool Atlas。

适配器不会执行 tools、加载 skill 正文或授予权限；每个源 registry 仍保留其 authority。

## Model Experience

### 投影的 capability metadata 与 operating protocol

#### What the model sees

模型会看到稳定的 capability catalog、共享的 HARDNESS lifecycle guide 与可 replay 的 audit trace，而执行仍由 PHOENIX 管理。

##### HARDNESS mission guidance

```markdown
Consumers may expose stable capability identifiers such as `tool:<name>`, `skill:<name>`, and `openclaw:<id>` together with compatibility and verification state; execution remains behind PHOENIX approval and canonical registries.

When the canonical system-prompt service is mounted, this package installs the `hardness:operating-protocol` section. It gives every model the same lifecycle vocabulary and requires resolution, approval, verification, presentation, and evidence before a task is described as complete.

Tool projections may subscribe to `tools/change`; this keeps dynamically connected tools, including MCP tools, represented in HARDNESS while registrations are reversible. The internal `hardness_run` tool is excluded from that projection to prevent recursive routing.

Each live mission appends a secret-free `hardness/mission` trace to the calling session. The trace records terminal protocol states, capability identity, artifact/evidence references, and stable reason codes; `replayHardnessMissionAudit` reconstructs one call without replaying arguments, credentials, or provider error text.

Inspect the need, resolve a verified capability, plan the operation, obtain approval, execute through the governed runtime, verify the artifact, present it, and record evidence before claiming completion.
```

#### Token effect

protocol section 和 capability metadata 会增加模型 token；单纯索引源 registry 不会增加 prompt 文本。

#### KV Cache effect

只要源 schema、extension metadata 与验证状态保持不变，投影 catalog 就保持良好的 KV cache 复用特性。

## Known Limitations and Deferred Work

- 外部 extension 执行继续由 Capability Broker 与隔离 package-host contract 管理，不会在启动时被 eager activate。
- 持久化 mission trace 需要 live agent session；没有 session 的直接 runner 单元调用不会记录，也不能作为 production proof。
