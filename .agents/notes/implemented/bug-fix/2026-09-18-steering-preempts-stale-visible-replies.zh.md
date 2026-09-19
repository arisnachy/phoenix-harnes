# Agent Note: Steering preempts stale visible replies

Status: implemented

## Problem

当新的人工指令在当前模型请求仍在为旧提示词流式输出回复时到达，如果把这条指令排到下一轮，输入框虽然会立即确认发送，但 assistant 仍继续明显回答旧提示词，看起来就像新指令被忽略或到达太晚。Web 客户端还可能为同一次已接纳发送短暂同时渲染本地 optimistic submit 与 Host 权威的 pending-steering 投影。

## Decision

当支持 steer 的主会话正在运行时，普通 Enter 默认使用 `Steer`；互补的 Cmd/Ctrl+Enter 改为 Queue，持久化的用户偏好仍可交换这两个手势。会话空闲时仍按普通 Queue 轮次提交。

AgentLoop 除了 turn abort 之外，还为活动模型请求提供一个仅属于该 stream 的 abort owner。一旦该请求已经输出可见 assistant 文本，被接纳的 steering 只会中断这条模型流，把已经可见的前缀记录为 interrupted assistant 消息，并保持当前 turn 存活，使 steering 在下一个 step 被领取。在可见 assistant 文本出现之前或工具正在执行时到达的 steering 保留既有的 step 边界行为，因此用户再次输入不会无意取消隐藏准备过程或工具副作用。

Web 客户端会在 optimistic admission 期间保留提交模式，并同时用 Host pending-steering 镜像和后续 durable steering 消息对账本地 steering submit。因此，一次被接纳的人工操作在本地、Host 与 durable 交接全过程只显示一个气泡。

## Verification

AgentLoop 覆盖让一个已经输出可见文本的模型流保持悬挂，在第一个可见 delta 后注入 steering，并验证下一次模型请求包含该 steering 且没有打开新的 turn。Conversation 测试固定 Steer-first 键盘策略，以及本地 optimistic 状态、Host pending steering 与 durable steering 节点之间的单气泡交接。组装后的 Web steering 场景同时覆盖默认手势和用户切换到 Queue 的偏好。

## Alternatives considered

**繁忙时普通 Enter 永远 Queue。** 这能保持严格轮次顺序，但会把新的人工指令放到用户正在试图改变的回复之后，从而重现“到达太晚”的行为。

**steering 到达时取消整个 turn。** 这能很快让新指令生效，但也可能中止工具和部分完成的副作用，使普通输入拥有与显式 Stop 相同的语义。

**在输出可见文本之前就中断所有活动模型流。** 这还能进一步降低延迟，但可能丢弃正在构造工具调用或其他不可见工作的请求。当前规则只抢占陈旧的可见文本，同时在尚无可见输出时保留既有安全边界。

**只修 Web 展示。** 隐藏或重排气泡无法让已经运行的模型请求看到它从未接收的指令，因此仅修改展示不能解决行为竞态。

## Consequences

在陈旧可见文本输出期间输入的后续指令无需等待旧回复结束，就能进入下一次模型请求；已经渲染的文本仍会持久保存并明确标记为 interrupted。中断可能增加一次模型请求并消耗少量额外 token，但避免继续为用户已经替换的回复消耗输出 token。工具执行以及尚未输出可见 assistant 文本的 stream 仍按边界 steering，因此当不可中断操作占有 step 时，回复不保证在按键瞬间切换。Queue 仍可通过互补快捷键或持久化偏好使用。
