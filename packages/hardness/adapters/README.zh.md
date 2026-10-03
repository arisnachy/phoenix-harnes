# `@phoenix-ai/dsh-hardness-adapters`

[English](README.md) | 中文

将 PHOENIX 现有 tools 与 skills 的 metadata 投影到 HARDNESS Tool Atlas。

Capability index 不会执行 tools、加载 skill 正文或授予权限；每个源 registry 仍保留其 authority。

适配器将 host 负责的索引与面向模型的工具分开。Host composition 使用 `modelTools: false`，只索引 capability 并安装一次共享的 mission runtime。完整 Agent preset 使用 `modelTools: true`，在自己的 scope 中提供 `hardness_run` 与 `connector_list`，不会重复注册共享的 HARDNESS registry。因此 minimal preset 可以保持有意精简的工具目录。

## 本地助手邮箱

驻留 Web host 可在 Settings → Connectors → Correo propio de Phoenix 中注册 Phoenix 自有邮箱，使用 AgentMail 免费方案包含的 `agentmail.to` 域名。注册显示服务商实际返回的地址；指定的人类所有者必须先完成邮件验证，收到的邮件才会成为任务。已有免费域名账户可用 API key 连接，再单独验证所有者。密钥保存在 credential service 中，不进入聊天、账户文件或状态响应。不创建自定义域名、付费升级或公开 webhook。

只有经服务商认证、来自已验证所有者或显式授权联系人的入站邮件才能创建任务。自动邮件、Phoenix 自身邮件、被阻止、垃圾、未认证邮件及未授权发件人不会调用模型。邮件正文不能授予权限。Kira 使用所选协调者的模型、工作目录和 preset，在独立持久会话中执行任务；沿用现有子代理选择、审批及正常回合完成规则。`phoenix_mail_complete` 只记录经验证的回复提议，不能发送邮件，也不能完成其他会话的任务。回复仅发给授权发件人，覆盖 Reply-To 并排除 CC。

收件由本地 host 持有，不由浏览器持有。关闭聊天后 host 继续运行；关闭 PC 后停止执行。启动时轮询补收邮件并恢复持久任务。出站 WebSocket 通知降低延迟，断线后重新连接。单封邮件读取失败不会阻塞其他任务；后续轮询会重试。Windows 桌面安装可选择创建或删除仅由 Phoenix 持有的 **PHOENIX Assistant** 登录快捷方式，从持久安装目录隐藏启动后台进程，不打开浏览器。

本地配置：`mailDirectory` 默认为 task ledger 旁的 `phoenix-mail`；`mailCredentialRef` 默认为 `PHOENIX_AGENTMAIL_API_KEY`；`mailPollMs`、`mailTimeoutMs`、`mailWorkTimeoutMs` 默认分别为 60,000、30,000、600,000 毫秒。账户、任务和 outbox 使用串行原子私有文件写入。已有账户验证在 24 小时或十次尝试后失效。注册结果不确定时不会自动重复注册。回复和定时邮件重试保持相同的持久化正文与幂等键；超过服务商 24 小时幂等窗口仍未确认的发送会等待所有者核查，避免重复邮件。达到免费额度时停止，不升级付费。模型仍遵守原有费用与限制。

主页提示的处理回执保存在 task ledger 旁。打开或关闭当前提示后，同一版本在刷新后仍被隐藏；新的实质版本仍可出现。先过滤回执，再限制 endpoint 最多返回八行。较新成功运行会取代旧错误。邮件结果与具体阻塞原因加入现有主页，不增加新仪表盘。

驻留 host 在调用模型前检查邮箱是否可用，并复用已持久化的邮件内容，不重新生成正文。每封出站邮件保留任务与执行周期标识。每次重试重新检查持久任务状态和收件人授权；暂停、取消、完成或缺失的任务不能发送待处理邮件，已有尝试证据仍予保留。条件邮件仅在服务商确认发送后完成。超过服务商 24 小时幂等窗口仍未确认的邮件需要所有者核查，不会自动重试任务。Host 销毁会取消服务商请求、等待已有发送结束并拒绝新发送。用户选择的发件身份继续使用受治理的连接器。

## 持久主动任务

Phoenix 为每个持久 ledger 维护一个进程共享的 task engine。默认 ledger 为 `~/.dsh/phoenix-tasks.json`；写入采用原子方式，在平台支持 POSIX mode 时，JSON 文件只允许当前用户访问。面向模型的 scope 与 Host runtime 共享同一个进程内 engine，因此不会分别缓存同一 task 文件的竞争快照。

`phoenix_task_create` 用于调度用户请求或 Phoenix 主动发起的未来工作。支持一次性任务、带锚点的 interval recurrence，以及 calendar-safe yearly recurrence。Yearly recurrence 可接受 IANA timezone，使生日和纪念日在闰年与时区变化下仍保持预期的本地日历日期。`phoenix_task_list`、`phoenix_task_pause`、`phoenix_task_resume` 与 `phoenix_task_cancel` 提供面向模型的管理界面。

每个 occurrence 都具有稳定的 idempotency key 和不可变执行历史。重启后发现处于 `running` 状态的 task 会恢复为 `scheduled`。如果电脑在到期时间处于关机状态，catch-up policy 决定恢复方式：`latest` 只运行最新一次遗漏 occurrence，`all` 在有界范围内重放遗漏 occurrence，`skip` 跳过旧工作并推进调度。Recurrence 始终保持原始锚点，不会从 Phoenix 实际重启的时间开始漂移。

Task 可以使用 `visibility: surprise`。在 reveal time 之前，它不会出现在普通列表中；如果 recurring surprise 没有显式 reveal time，则直到当前 delivery occurrence 才显示。可选的私有 preparation 可以在 delivery 前按配置的 lead time 执行，其有界结果会传递给 reveal step。Surprise 内容仍保存在持久内部 ledger 中供 recovery 与 audit 使用；这是 presentation-private 功能，不是不可审计的秘密通道。

Host 会轮询持久 engine，并在 agent 创建时主动 pump。Chat delivery 通过 proactive follow-up 唤醒在线目标 agent。私有 preparation、定时 office work 与 email 使用配置的一次性 subagent provider。若不存在在线 execution target，则 execution 会延后，不会消耗该 occurrence。

循环 `delivery: work` 任务可以维护用户明确要求的持续目标，例如研究、课程准备、项目监控或体育分析。执行时会重新验证现实状态，并可使用已经授权的 MCP/connector；持久兴趣授权分析，而不是外部交易。实质结果会进入有界排序的 loopback attention 投影，没有变化的循环运行可以返回 `NO_MATERIAL_UPDATE`，浏览器只在空白会话 Hero 中显示价值最高的少量信息。可选的 task attention metadata 只控制结果或 upcoming occurrence 是否参与展示，不会改变任务执行。

Email 有两个独立 identity reference。`userMailIdentity` 表示获授权的用户 mailbox，用于代表用户发送 office work；`harnessMailIdentity` 表示 Phoenix 自己的 mailbox，用于直接与用户通信。Task 可选择 `user`、`harness` 或 `auto`；`auto` 优先使用 Phoenix identity，并在不可用时回退到 user identity。这些 reference 不包含 credential，scheduled execution 也不会绕过正常的 mail-tool authorization 或 approval。

相关配置键为 `taskLedgerPath`、`taskPollMs`、`privateWorkProvider`、`privateWorkResultChars`、`userMailIdentity` 与 `harnessMailIdentity`。特殊的 `:memory:` ledger 仅用于确定性测试与临时 composition。

## 自主执行策略

面向模型的 preset 现在暴露 `hardness_workflow.executionMode`，使 Phoenix 能在 execution planning 前区分范围明确的 `fast` 工作与 `standard`、`deep` mission。对于 fast work，组装后的 HARDNESS guidance 对 generic methodology-skill 仪式拥有过程 authority：不能仅因为 generic skill catalog 列出了 brainstorming 或 implementation planning，就再次要求 routine approval。Phoenix 执行最小安全变更并收集新的定向验证；如果证据显示失败、新风险、更大范围、外部依赖或独立工作，workflow 会被增强，而不是放弃 mission。

同一策略也会在 active goal round 中被强化。已经授权的 mission 遇到可恢复的 tool 或 verification failure 时，会通过修复、替代 route、能力获取/构建或实质不同的策略继续推进。内部 retry/round limit 不能完成或取消 mission。Permission、credential、safety policy、provider quota、明确拒绝以及真正无法满足的外部 dependency 仍是硬边界，fast path 永远不会绕过这些限制。

## 运行时验证

模拟蜡烛图读取将 provider 请求和返回行数都限制为 1–1000。Shell 修改分类读取 command 参数。运行时服务遥测立即执行首次探测，随后在 TTL 过期前复用观察结果。

## Model Experience

### 投影的 capability metadata 与 operating protocol

#### What the model sees

模型会看到稳定的 capability catalog、共享的 HARDNESS lifecycle guide 与可 replay 的 audit trace，而执行仍由 PHOENIX 管理。

##### HARDNESS mission guidance

```markdown
Consumers may expose stable capability identifiers such as `tool:<name>`, `skill:<name>`, and `openclaw:<id>` together with compatibility and verification state; execution remains behind PHOENIX approval and canonical registries.

When the canonical system-prompt service is mounted, this package installs the `hardness:operating-protocol` section. It gives every model the same lifecycle vocabulary and requires resolution, approval, verification, presentation, and evidence before a task is described as complete.

Model-facing scopes also install `hardness:proactivity-protocol`. It tells the model to use durable tasks for explicit reminders and useful autonomous follow-ups, turn explicit ongoing objectives into bounded recurring background work when useful, prefer authorized event-driven connectors over polling, suppress unchanged background results, preserve calendar timing, and keep all external actions behind the same authorization policy used for immediate work.

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

##### X MCP activation

```markdown
Full model-tool scopes also expose `x_mcp_activate`. It is usable only after an explicit user request and one-shot medium-risk approval. The user identity maps to `x-api`; the Phoenix-owned identity maps to `x-api-phoenix`, so their OAuth sessions stay separate. If the Phoenix-owned account does not exist yet, activation returns `setup-required`, defers an instruction to continue through Computer Use at `https://x.com/signup`, and stops for required human verification before connecting the resulting username. Setup never posts, follows, DMs, or performs another social action.
```

#### Token effect

protocol section 和 capability metadata 会增加模型 token；单纯索引源 registry 不会增加 prompt 文本。

#### KV Cache effect

只要源 schema、extension metadata 与验证状态保持不变，投影 catalog 就保持良好的 KV cache 复用特性。


## Known Limitations and Deferred Work

- 外部 extension 执行继续由 Capability Broker 与隔离 package-host contract 管理，不会在启动时被 eager activate。
- 持久化 mission trace 需要 live agent session；没有 session 的直接 runner 单元调用不会记录，也不能作为 production proof。
- 旧版定时邮件 identity 仍是配置引用，需要已授权的邮件工具。本地助手邮箱单独注册 AgentMail 免费域名账户；真实注册和验证需要所有者及服务商可用。入站任务正文有长度限制，附件不会自动执行。
- `surprise` visibility 会从普通 task listing 与 compact tool presentation 中隐藏尚未 reveal 的内容，但持久 ledger 会有意保留，以便获授权的 operator 审计。
