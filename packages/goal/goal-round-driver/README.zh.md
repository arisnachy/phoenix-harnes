# @phoenix-ai/dsh-goal-round-driver

[English](README.md) | 中文

[`ctx.goals`](../goal/README.zh.md) 的同会话续行驱动器。它通过公开 `Agent` 与会话服务，把 phase 为 active 且已启用续行的目标转换为连续的 [Goal Round](../../../docs/glossary.zh.md#goal-round)；[同会话驱动器 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-same-session-goal-round-driver.zh.md) 记载竞态与生命周期方面的设计理由。

## 组合

```yaml
- id: goal
  name: '@phoenix-ai/dsh-goal'

- id: tool-goal
  name: '@phoenix-ai/dsh-tool-goal'

- id: goal-round-driver
  name: '@phoenix-ai/dsh-goal-round-driver'
```

该插件没有可调配置。`maxGoalRounds` 属于目标定义，面向模型的阻塞阈值则属于 [`dsh-tool-goal`](../tool-goal/README.zh.md)；在驱动器中重复任一数值都可能产生分歧策略。

## Round 约定

当对应的活跃 agent（智能体）实例处于 idle 状态，且目标 phase 为 active、已启用续行并有剩余容量时，驱动器先为待处理 goal 变更创建检查点，再预留 `roundsStarted + 1`，对应当前 `{ goalId, revision }`。它会排入一条 `<goal_round>` 提示词，并携带 `GoalMessageSource`。`agent/pre-step` 监听器会在下游监听器前后验证完整的已领取记录与当前 goal；只有进入步骤的 `user/message` 才会增加 `roundsStarted`。因陈旧而被拒绝的预留不会消耗 Round 编号。当窗口达到 `maxGoalRounds` 时，驱动器会持久化续行检查点、轮换 goal 修订号、重置窗口计数并立即驱动新窗口；它不会将任务变成 round-limit 失败。

`MessageId` 通过持久 inbox 插入和领取来标识预留消息；它不标识轮次结果。人类消息不消耗 goal 上限。如果人类工作在预留前进入 inbox，或加入预留的待处理批次，自动工作会让行，直到 agent 进入 idle；混合批次中的待处理自动提示词会被拒绝，只有在该检查点之后才重新预留。

保留的提示词会点明经过 JSON 引用的目标与 `round/maxGoalRounds`，将当前工作区、工具结果和持久会话状态视为权威信息，要求在完成前提供证据，并要求第一次未成功后使用与早先尝试实质不同的策略。带有 `automatic: true` 的问题结果明确只是步骤决定，不能完成、取消或阻塞活动任务；模型必须继续执行或更换策略。任何明确的待处理、剩余、TODO 或尚未完成的要求都属于任务债务：下一 Round 必须解决它们，而不能把它们作为最终交付。当技术工具或能力缺失时，提示词要求先检查 ATLAS、连接器和替代路线，再在 runtime 允许时受控地获取或构建最小辅助能力并完成测试。工作仍未完成时保持目标 active。引用可将多行或形似标签的目标文本保留为数据。goal 生命周期变更仍必须通过 `dsh-tool-goal` 的独立权限检查。

## 任务债务停止防护

即使模型忘记调用 `create_goal`，普通的直接人类请求也可以进入持久 goal 生命周期。在现有的 `agent/turn-stopping` 扩展点，驱动器只检查当前 root agent 的本轮事件。只有三个事实都已持久化时才自动创建 goal：本轮包含直接人类输入、至少一个真实 `tool/call`，并且最终 assistant 文本明确说明仍有未解决工作，例如 `Pendiente:`、`Pending:` 或 `not yet`。纯文本对话以及明确说明没有剩余债务的工具辅助回答会正常停止。完整的人类请求成为持久目标；assistant 的债务行只作为检测证据，绝不会替代目标。

该防护有意保持窄范围。它不会从不确定性、一般性的未来建议或普通会话语言推断未完成工作，插件生成的消息也不能授予自动创建任务所需的直接人类权限。goal 创建后，现有驱动器继续负责续行、持久性、策略轮换、对抗式完成验证和独立 completion judge。

## Idle 检查点

整个 agent 进入 idle 时，持久 goal phase 和 revision 具有权威性。phase 为 active、已启用续行且仍有容量的 goal 会预留下一 Round；达到上限会创建新的 active revision，而不是完成或阻塞任务。完成、暂停、阻塞和编辑都会阻止续行。驱动器不会通过关联 goal 消息与 `turn/end` 来对前一段活动分类，因此提供方错误和 token 上限仍是尝试级结果。

## 生命周期与持久性

`goal/changed` 会产生持久性义务。排队工作前，驱动器会等待 `ctx.sessions.flush()`，并在等待后重新检查 goal revision 与竞争输入。通过 `agent/error` 到达的 flush 失败会停用续行，避免另一 Round 启动。

此插件加载到现有 agent 上时绝不会继承续行启用状态。`GoalService.disarm()` 会移除进程本地权限，而不改变持久 phase、revision 或历史。在 `agent/session-start` 上，驱动器会重放 active goal、恢复进程本地续行权限并安排恢复；blocked goal 仍等待外部条件或明确的 resume。会话 resume 和 fork 后仍使用同一份持久状态。

取消会移除 inbox 中待处理的工作，或留下 agent 范围的 aborted 状态。在下一次 idle 检查点，驱动器会暂停存在已预留或已准入尝试的 goal，避免取消后自动重启；与 goal 尝试无关的取消只会撤销进程本地续行权限。如果 pause 变更失败，驱动器会回退到停用续行。插件 teardown 会关闭准入，停用所有活跃 goal 的续行，以 `parent` cause 取消正在进行的工作，并在事件防护仍生效的情况下等待驱动器和 agent 完全停稳。

## 模型体验

### Goal Round 提示词

#### 模型看到的内容

每个已准入 Round 都是一段保留的用户角色 `<goal_round>` 块，其中点明完整目标与正数 Round 编号。更早的用户消息、goal 状态快照、assistant 输出与工具记录仍保留在同一会话历史中。

##### Goal Round 协议

```markdown
The model receives the complete objective and positive round number in the retained `<goal_round>` block.
```

##### Judge 反馈

```markdown
When the previous completion judge returned needs_changes or blocked, the driver reconstructs that result from the durable goal/judge event and places its bounded findings and required changes in the next round prompt. This survives process restart and is consumed by the automatically resumed active mission.
```

##### Supervisor 检查点

```markdown
The driver also writes bounded goal/supervisor checkpoints. A checkpoint records the exact goal revision, admitted round count, supervisor status, next action, and a redacted failure summary. On session start the latest checkpoint is replayed before an active mission is driven again.
```

##### Strategy 选择

```markdown
Before each admitted continuation, the driver records one strategy selection in goal/strategy and includes it in the prompt. The bounded rotation is baseline, verification-first, alternate-tool, and minimal-change; the next selection is deterministic and never repeats the immediately previous strategy.
```

#### Token 影响

每个已准入 Round 会增加一个固定指令块和目标。后续请求会重新发送保留的 Round，直到压缩（compaction）将其遮蔽；不会创建新 agent，也不会复制对话前缀。

#### KV Cache 影响

在一个 epoch 内仅追加：每个已准入 Round 都会在可复用前缀后扩展现有对话。压缩可能替换派生历史后缀，并移动可复用边界。

## 已知限制与暂缓事项

- **Judge 提供方策略独立**：`dsh-tool-goal` 可以要求独立的只读 judge，驱动器会重放其发现；提供方选择与 judge 调用仍属于此包之外。
- **只在同一会话执行**：此包有意不 spawn 新 agent、不 fork 会话前缀，也不实现 Ralph 风格的独立尝试；该工作流属于单独的插件层。
- **已接受队列的卸载竞态**：Cordis 插件卸载是异步的。已经被 agent inbox 接受的 goal 提示词可以在卸载开始前启动并消耗其 Round；teardown 随后会取消请求、停用 goal 的续行并等待完全停稳。不会再启动后续 Round。
- **Round 上限是窗口上限，不是任务预算**：token、货币、时间与提供方配额策略保持独立。达到上限会轮换 goal 修订号，不能结束任务。
- **有界恢复具有选择性**：`max-tokens` 轮次和普通提供方失败会作为未完成的尝试持久化，并在 goal 保持 active 时调度下一轮；持久化失败仍会停用续行，直到数据可安全保存，提供方级有界重试仍由 `llm-retry` 负责。
