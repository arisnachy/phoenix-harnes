# `@phoenix-ai/dsh-hardness-adapters`

[English](README.md) | 中文

将 PHOENIX 现有 tools 与 skills 的 metadata 投影到 HARDNESS Tool Atlas。

适配器不会执行 tools、加载 skill 正文或授予权限；每个源 registry 仍保留其 authority。

适配器将 host 负责的索引与面向模型的工具分开。Host composition 使用 `modelTools: false`，只索引 capability 并安装一次共享的 mission runtime。完整 Agent preset 使用 `modelTools: true`，在自己的 scope 中提供 `hardness_run` 与 `connector_list`，不会重复注册共享的 HARDNESS registry。因此 minimal preset 可以保持有意精简的工具目录。

## 持久主动任务

Phoenix 为每个持久 ledger 维护一个进程共享的 task engine。默认 ledger 为 `~/.dsh/phoenix-tasks.json`；写入采用原子方式，在平台支持 POSIX mode 时，JSON 文件只允许当前用户访问。面向模型的 scope 与 Host runtime 共享同一个进程内 engine，因此不会分别缓存同一 task 文件的竞争快照。

`phoenix_task_create` 用于调度用户请求或 Phoenix 主动发起的未来工作。支持一次性任务、带锚点的 interval recurrence，以及 calendar-safe yearly recurrence。Yearly recurrence 可接受 IANA timezone，使生日和纪念日在闰年与时区变化下仍保持预期的本地日历日期。`phoenix_task_list`、`phoenix_task_pause`、`phoenix_task_resume` 与 `phoenix_task_cancel` 提供面向模型的管理界面。

每个 occurrence 都具有稳定的 idempotency key 和不可变执行历史。重启后发现处于 `running` 状态的 task 会恢复为 `scheduled`。如果电脑在到期时间处于关机状态，catch-up policy 决定恢复方式：`latest` 只运行最新一次遗漏 occurrence，`all` 在有界范围内重放遗漏 occurrence，`skip` 跳过旧工作并推进调度。Recurrence 始终保持原始锚点，不会从 Phoenix 实际重启的时间开始漂移。

Task 可以使用 `visibility: surprise`。在 reveal time 之前，它不会出现在普通列表中；如果 recurring surprise 没有显式 reveal time，则直到当前 delivery occurrence 才显示。可选的私有 preparation 可以在 delivery 前按配置的 lead time 执行，其有界结果会传递给 reveal step。Surprise 内容仍保存在持久内部 ledger 中供 recovery 与 audit 使用；这是 presentation-private 功能，不是不可审计的秘密通道。

Host 会轮询持久 engine，并在 agent 创建时主动 pump。Chat delivery 通过 proactive follow-up 唤醒在线目标 agent。私有 preparation、定时 office work 与 email 使用配置的一次性 subagent provider。若不存在在线 execution target，则 execution 会延后，不会消耗该 occurrence。

Email 有两个独立 identity reference。`userMailIdentity` 表示获授权的用户 mailbox，用于代表用户发送 office work；`harnessMailIdentity` 表示 Phoenix 自己的 mailbox，用于直接与用户通信。Task 可选择 `user`、`harness` 或 `auto`；`auto` 优先使用 Phoenix identity，并在不可用时回退到 user identity。这些 reference 不包含 credential，scheduled execution 也不会绕过正常的 mail-tool authorization 或 approval。

相关配置键为 `taskLedgerPath`、`taskPollMs`、`privateWorkProvider`、`privateWorkResultChars`、`userMailIdentity` 与 `harnessMailIdentity`。特殊的 `:memory:` ledger 仅用于确定性测试与临时 composition。

## 自主执行策略

面向模型的 preset 现在暴露 `hardness_workflow.executionMode`，使 Phoenix 能在 execution planning 前区分范围明确的 `fast` 工作与 `standard`、`deep` mission。对于 fast work，组装后的 HARDNESS guidance 对 generic methodology-skill 仪式拥有过程 authority：不能仅因为 generic skill catalog 列出了 brainstorming 或 implementation planning，就再次要求 routine approval。Phoenix 执行最小安全变更并收集新的定向验证；如果证据显示失败、新风险、更大范围、外部依赖或独立工作，workflow 会被增强，而不是放弃 mission。

同一策略也会在 active goal round 中被强化。已经授权的 mission 遇到可恢复的 tool 或 verification failure 时，会通过修复、替代 route、能力获取/构建或实质不同的策略继续推进。内部 retry/round limit 不能完成或取消 mission。Permission、credential、safety policy、provider quota、明确拒绝以及真正无法满足的外部 dependency 仍是硬边界，fast path 永远不会绕过这些限制。

## Model Experience

### 投影的 capability metadata 与 operating protocol

#### What the model sees

模型会看到稳定的 capability catalog、共享的 HARDNESS lifecycle guide 与可 replay 的 audit trace，而执行仍由 PHOENIX 管理。

##### HARDNESS mission guidance

```markdown
Consumers may expose stable capability identifiers such as `tool:<name>`, `skill:<name>`, and `openclaw:<id>` together with compatibility and verification state; execution remains behind PHOENIX approval and canonical registries.

When the canonical system-prompt service is mounted, this package installs the `hardness:operating-protocol` section. It gives every model the same lifecycle vocabulary and requires resolution, approval, verification, presentation, and evidence before a task is described as complete.

Model-facing scopes also install `hardness:proactivity-protocol`. It tells the model to use durable tasks for explicit reminders and useful autonomous follow-ups, avoid duplicates and spam, use private preparation for surprises, preserve calendar timing, and keep all scheduled external actions behind the same authorization policy used for immediate work.

Tool projections may subscribe to `tools/change`; this keeps dynamically connected tools, including MCP tools, represented in HARDNESS while registrations are reversible. The internal `hardness_run` tool is excluded from that projection to prevent recursive routing.

Each live mission appends a secret-free `hardness/mission` trace to the calling session. The trace records terminal protocol states, capability identity, artifact/evidence references, and stable reason codes; `replayHardnessMissionAudit` reconstructs one call without replaying arguments, credentials, or provider error text.

The runner exposes an optional `HardnessMissionTelemetry` observer derived from those same audit rows. Its snapshot reports attempts, completed and blocked missions, recovery attempts, per-step outcomes, bounded latency totals/maxima, and stable blocked reason counts; `replayHardnessMissionTelemetry` rebuilds the metrics from durable rows. Telemetry is best-effort and cannot block a mission.

## Mission Persistence Kernel

`MissionPersistenceKernel` keeps mission state separate from disposable work. Attempt, plan, tool, and strategy failures are recorded with a bounded fingerprint and never become a mission-level `FAILED` state. A blocked dependency opens `WALL_PROTOCOL`, persists the exact missing dependency, proposes bounded alternative routes, and leaves the mission `WAITING_EXTERNAL` until `resume()` is durable.

At start, the kernel locks the objective, deliverables, mandatory acceptance criteria, and quality requirements. Each criterion must advance through `PENDING`, `IMPLEMENTED`, `TESTED`, and `VERIFIED`. The kernel rejects repeated strategies, stores root causes and reusable solutions as `hardness/kernel` session events, and enters `VERIFYING` before review. Only an independent judge with criterion evidence and a passing quality gate can transition a mission to `DONE`; an explicit `cancel()` is the only alternative terminal action. A successful capability execution therefore remains progress evidence, not permission to close the mission.

The kernel resolves protocol disputes with the immutable order `safety > approval > goal > judge > router > executor > presentation`. Distinct authorities record the higher layer without bypassing that layer's own gate; equal authorities fail closed in `WAITING_EXTERNAL`. Each resolution is appended as an `authority-conflict` event and replay restores both the conflict record and resulting status. Approval denial records `approval` versus `executor` before the blocked result, so a late executor outcome cannot override the broker. The shipped rationale is recorded in the [mission authority precedence Agent Note](../../../.agents/notes/implemented/architecture/2026-09-15-hardness-mission-authority-precedence.md).

The runner always has a local deterministic judge. It mechanically verifies artifact identity, rendering, durable evidence, and mandatory criteria in `TESTED` or `VERIFIED`; it returns `needs_changes` rather than passing incomplete evidence. When the base profile supplies the `spawn` subagent provider, the stronger semantic judge is used instead. That child receives a bounded candidate summary, uses only read-only inspection tools, returns the structured verdict and evidence, and is disposed after every review. `needs_changes` keeps the mission active and exposes the required repair list; an unavailable semantic judge leaves it blocked instead of silently accepting the artifact.

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

## Known Limitations and Deferred Work

- 外部 extension 执行继续由 Capability Broker 与隔离 package-host contract 管理，不会在启动时被 eager activate。
- 持久化 mission trace 需要 live agent session；没有 session 的直接 runner 单元调用不会记录，也不能作为 production proof。
- Email identity 只是配置引用；本包不会创建外部 mailbox 账户。所选 provider/tool 必须事先完成配置并获得授权。
- `surprise` visibility 会从普通 task listing 与 compact tool presentation 中隐藏尚未 reveal 的内容，但持久 ledger 会有意保留，以便获授权的 operator 审计。
