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

When the canonical system-prompt service is mounted, this package installs the `hardness:operating-protocol` section. It gives every model the same lifecycle vocabulary and requires resolution, approval, verification, presentation, and evidence before a task is described as complete.

Tool projections may subscribe to `tools/change`; this keeps dynamically connected tools, including MCP tools, represented in HARDNESS while registrations are reversible. The internal `hardness_run` tool is excluded from that projection to prevent recursive routing.

Each live mission appends a secret-free `hardness/mission` trace to the calling session. The trace records terminal protocol states, capability identity, artifact/evidence references, and stable reason codes; `replayHardnessMissionAudit` reconstructs one call without replaying arguments, credentials, or provider error text.

The runner exposes an optional `HardnessMissionTelemetry` observer derived from the same audit rows. Its snapshot reports attempts, completed and blocked missions, recovery attempts, per-step outcomes, bounded latency totals/maxima, and stable blocked reason counts; `replayHardnessMissionTelemetry` rebuilds metrics from durable rows. Telemetry is best-effort and cannot block a mission.

## Mission Persistence Kernel

`MissionPersistenceKernel` keeps mission state separate from disposable work. Attempt, plan, tool, and strategy failures are recorded with a bounded fingerprint and never become a mission-level `FAILED` state. A blocked dependency opens `WALL_PROTOCOL`, persists the exact missing dependency, proposes bounded alternative routes, and leaves the mission `WAITING_EXTERNAL` until `resume()` is durable.

At start, kernel 会锁定 objective、deliverables、mandatory acceptance criteria 与 quality requirements。每个 criterion 必须经过 `PENDING`、`IMPLEMENTED`、`TESTED` 与 `VERIFIED`。Kernel 会拒绝重复 strategy，把 root cause 与 reusable solution 保存为 `hardness/kernel` session event，并在 review 前进入 `VERIFYING`。只有具备 criterion evidence 且 quality gate 通过的 independent judge 才能把 mission 转为 `DONE`；显式 `cancel()` 是唯一的另一种 terminal action。因此，成功的 capability execution 仍然只是 progress evidence，不是关闭 mission 的 permission。

Kernel 使用不可变顺序 `safety > approval > goal > judge > router > executor > presentation` 解析 protocol dispute。不同 authority 会记录较高层，但不会绕过该层自己的 gate；相同 authority 会 fail closed 并进入 `WAITING_EXTERNAL`。每次解析都会追加 `authority-conflict` event，replay 会恢复 conflict record 与 resulting status。Approval denial 会在 blocked result 前记录 `approval` 对 `executor`，因此延迟的 executor outcome 不能覆盖 broker 决定。已发布的 rationale 记录在 [mission authority precedence Agent Note](../../../.agents/notes/implemented/architecture/2026-09-15-hardness-mission-authority-precedence.zh.md)。

runner 始终提供 local deterministic judge：它机械检查 artifact identity、rendering、durable evidence，以及处于 `TESTED` 或 `VERIFIED` 的 mandatory criteria；证据不完整时返回 `needs_changes`，不会误报 `pass`。base profile 提供 `spawn` subagent provider 时，runner 改用更强的 semantic judge。The child receives a bounded candidate summary, uses only read-only inspection tools, returns the structured verdict and evidence, and is disposed after every review. `needs_changes` keeps the mission active and exposes the required repair list; an unavailable semantic judge leaves it blocked instead of silently accepting the artifact.

The model-facing `hardness_run` result makes recovery explicit. A blocked result is non-terminal and always includes `mission_status` (`ACTIVE`, `RECOVERING`, or `WAITING_EXTERNAL`) and `next_action` (`repair_and_replan`, `retry_with_alternative`, or `wait_for_dependency`). The adapter also defers a durable recovery instruction into the next model request, so a tool failure cannot be mistaken for mission completion or justify a new plan-mode approval loop.

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

## 自主执行策略

面向模型的 preset 现在暴露 `hardness_workflow.executionMode`，使 Phoenix 能在 execution planning 前区分范围明确的 `fast` 工作与 `standard`、`deep` mission。对于 fast work，组装后的 HARDNESS guidance 对 generic methodology-skill 仪式拥有过程 authority：不能仅因为 generic skill catalog 列出了 brainstorming 或 implementation planning，就再次要求 routine approval。Phoenix 执行最小安全变更并收集新的定向验证；如果证据显示失败、新风险、更大范围、外部依赖或独立工作，workflow 会被增强，而不是放弃 mission。

同一策略也会在 active goal round 中被强化。已经授权的 mission 遇到可恢复的 tool 或 verification failure 时，会通过修复、替代 route、能力获取/构建或实质不同的策略继续推进。内部 retry/round limit 不能完成或取消 mission。Permission、credential、safety policy、provider quota、明确拒绝以及真正无法满足的外部 dependency 仍是硬边界，fast path 永远不会绕过这些限制。

## Known Limitations and Deferred Work

- 外部 extension 执行继续由 Capability Broker 与隔离 package-host contract 管理，不会在启动时被 eager activate。
- 持久化 mission trace 需要 live agent session；没有 session 的直接 runner 单元调用不会记录，也不能作为 production proof。
