# `@phoenix-ai/dsh-hardness-adapters`

[English](README.md) | 中文

将 PHOENIX 现有 tools 与 skills 的 metadata 投影到 HARDNESS Tool Atlas。

适配器不会执行 tools、加载 skill 正文或授予权限；每个源 registry 仍保留其 authority。

适配器将 host 负责的索引与面向模型的工具分开。Host composition 使用 `modelTools: false`，只索引 capability 并安装一次共享的 mission runtime。完整 Agent preset 使用 `modelTools: true`，在自己的 scope 中提供 `hardness_run` 与 `connector_list`，不会重复注册共享的 HARDNESS registry。因此 minimal preset 可以保持有意精简的工具目录。

## Model Experience

### 投影的 capability metadata 与 operating protocol

#### What the model sees

模型会看到稳定的 capability catalog、共享的 HARDNESS lifecycle guide 与可 replay 的 audit trace，而执行仍由 PHOENIX 管理。

##### HARDNESS mission guidance

```markdown
Consumers may expose stable capability identifiers such as `tool:<name>`, `skill:<name>`, and `openclaw:<id>` together with compatibility and verification state; execution remains behind PHOENIX approval and canonical registries.

When the canonical system-prompt service is mounted, this package installs the `hardness:operating-protocol` section. It gives every model the same lifecycle vocabulary and requires resolution, approval, verification, presentation, and evidence before a task is described as complete. The section also defines mission debt: pending requirements and technical capability gaps remain recovery work rather than a final handoff.

Tool projections may subscribe to `tools/change`; this keeps dynamically connected tools, including MCP tools, represented in HARDNESS while registrations are reversible. The internal `hardness_run` tool is excluded from that projection to prevent recursive routing.

Each live mission appends a secret-free `hardness/mission` trace to the calling session. The trace records terminal protocol states, capability identity, artifact/evidence references, and stable reason codes; `replayHardnessMissionAudit` reconstructs one call without replaying arguments, credentials, or provider error text.

## Mission Persistence Kernel

`MissionPersistenceKernel` keeps mission state separate from disposable work. Attempt, plan, tool, and strategy failures are recorded with a bounded fingerprint and never become a mission-level `FAILED` state. A blocked dependency opens `WALL_PROTOCOL`, persists the exact missing dependency, proposes bounded alternative routes, and leaves the mission resumable rather than allowing the failed attempt to masquerade as completion.

At start, the kernel locks the objective, deliverables, mandatory acceptance criteria, and quality requirements. Each criterion must advance through `PENDING`, `IMPLEMENTED`, `TESTED`, and `VERIFIED`. The kernel rejects repeated strategies, stores root causes and reusable solutions as `hardness/kernel` session events, and enters `VERIFYING` before review. Only an independent judge with criterion evidence and a passing quality gate can transition a mission to `DONE`; an explicit `cancel()` is the only alternative terminal action. A successful capability execution therefore remains progress evidence, not permission to close the mission.

The base profile supplies the `spawn` subagent provider to this judge. The child receives a bounded candidate summary, uses only read-only inspection tools, returns the structured verdict and evidence, and is disposed after every review. `needs_changes` keeps the mission active and exposes the required repair list; an unavailable judge leaves it blocked instead of silently accepting the artifact.

The model-facing `hardness_run` result makes recovery explicit. A blocked result is non-terminal and always includes `mission_status` (`ACTIVE`, `RECOVERING`, or `WAITING_EXTERNAL`) and `next_action` (`repair_and_replan`, `retry_with_alternative`, or `wait_for_dependency`). 技术缺口，例如缺少 capability、可执行 surface 或 executor，即使下层将其报告为 waiting，也会在面向模型的结果中归一化为 `RECOVERING`。PHOENIX 必须检查 ATLAS 和 connector inventory、尝试实质不同的路线，然后在 runtime 允许时获取或构建最小受控辅助能力并在使用前完成测试。`WAITING_EXTERNAL` 只用于 PHOENIX 无法自行创建或满足的依赖，例如直接人类授权、仅由用户控制的凭据、必须的物理操作或确实不可用的外部基础设施。适配器会把该恢复指令延迟注入下一次模型请求，因此技术阻塞不能被误认为 mission completion。

The loopback `artifact/run` endpoint executes a code artifact only through the mounted isolated `CodeRuntime`. A successful or failed structured result is appended as `hardness/artifact` with the artifact and tool-call identities, so reopening the session replays the latest sandbox result. The universal client surface forwards cancellation to that runtime and reports missing or incompatible runtimes as errors; it never falls back to browser evaluation for code.

Inspect the need, resolve a verified capability, plan the operation, obtain approval, execute through the governed runtime, verify the artifact, present it, and record evidence before claiming completion.
```

##### Connector inventory

```markdown
The model also receives the read-only connector_list tool when the authorization or MCP connector seam is mounted. Authorization rows report registered flows, provider telemetry, and sanitized callable service metadata. MCP rows report server identity, transport, lifecycle status, stable reason code, and public tool names. The tool never begins authorization, grants permission, invokes a connection, or exposes credentials or transport configuration.
```

#### Token effect

protocol section 和 capability metadata 会增加模型 token；单纯索引源 registry 不会增加 prompt 文本。

#### KV Cache effect

只要源 schema、extension metadata 与验证状态保持不变，投影 catalog 就保持良好的 KV cache 复用特性。

## Known Limitations and Deferred Work

- 外部 extension 执行继续由 Capability Broker 与隔离 package-host contract 管理，不会在启动时被 eager activate。
- 持久化 mission trace 需要 live agent session；没有 session 的直接 runner 单元调用不会记录，也不能作为 production proof。
