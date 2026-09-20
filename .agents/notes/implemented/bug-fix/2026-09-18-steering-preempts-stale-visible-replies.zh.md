# Agent Note: Steering preempts stale visible replies

Status: implemented

## Problem

当新的人工指令在当前模型请求仍在为旧提示词流式输出回复时到达，如果把这条指令排到下一轮，输入框虽然会立即确认发送，但 assistant 仍继续明显回答旧提示词，看起来就像新指令被忽略或到达太晚。Web 客户端还可能为同一次已接纳发送短暂同时渲染本地 optimistic submit 与 Host 权威的 pending-steering 投影。

## Decision

当支持 steer 的主会话正在运行时，普通 Enter 默认使用 `Steer`；互补的 Cmd/Ctrl+Enter 改为 Queue，持久化的用户偏好仍可交换这两个手势。会话空闲时仍按普通 Queue 轮次提交。

AgentLoop 除了 turn abort 之外，还为活动模型请求提供一个仅属于该 stream 的 abort owner。被接纳的人工 steering 会立即中断这个活动模型请求，无论它是否已经产生可见 assistant 文本，同时保持当前 turn 存活，使 steering 在下一个 step 被领取。如果被替换的请求已经产生可见文本，该前缀会记录为 interrupted assistant 消息；如果尚未产生可见内容，则不会合成 assistant 消息。工具执行仍保留既有的 step 边界行为，因此已经开始执行的工具副作用不会因为用户再次输入而被取消。

Web 客户端会在 optimistic admission 期间保留提交模式，并同时用 Host pending-steering 镜像和后续 durable steering 消息对账本地 steering submit。因此，一次被接纳的人工操作在本地、Host 与 durable 交接全过程只显示一个气泡。

## Verification

AgentLoop 覆盖同时固定两种情况：尚未输出可见文本的活动模型请求，以及已经输出可见文本后保持悬挂的模型流；两种情况下都注入 steering，并验证下一次模型请求包含该 steering 且没有打开新的 turn。可见前缀场景会把旧前缀持久保存为 interrupted 输出，而预可见场景不会创建 assistant 消息。Conversation 测试固定 Steer-first 键盘策略，以及本地 optimistic 状态、Host pending steering 与 durable steering 节点之间的单气泡交接。组装后的 Web steering 场景同时覆盖默认手势和用户切换到 Queue 的偏好。

## Alternatives considered

**繁忙时普通 Enter 永远 Queue。** 这能保持严格轮次顺序，但会把新的人工指令放到用户正在试图改变的回复之后，从而重现“到达太晚”的行为。

**steering 到达时取消整个 turn。** 这能很快让新指令生效，但也可能中止工具和部分完成的副作用，使普通输入拥有与显式 Stop 相同的语义。

**等到出现可见文本后才中断活动模型请求。** 否决，因为这个故障恰好可能发生在旧回复输出第一个可见 token 之前：新气泡已经出现，随后旧文本才冒出来。尚未分派的工具调用没有副作用需要保护，因此抢占该模型请求是安全的；已经开始运行的工具仍保持不受影响。

**只修 Web 展示。** 隐藏或重排气泡无法让已经运行的模型请求看到它从未接收的指令，因此仅修改展示不能解决行为竞态。

## Consequences

只要陈旧模型请求仍在活动，用户输入的后续指令就无需等待该请求结束即可进入下一次模型请求。已经渲染的文本仍会持久保存并明确标记为 interrupted；在出现可见输出之前被抢占的请求不会留下 assistant 表层。中断可能增加一次模型请求并消耗少量额外 token，但避免继续为用户已经替换的回复消耗输出 token。已经开始运行的工具仍按边界 steering，因此当不可中断副作用占有 step 时，回复不保证在按键瞬间切换。Queue 仍可通过互补快捷键或持久化偏好使用。
