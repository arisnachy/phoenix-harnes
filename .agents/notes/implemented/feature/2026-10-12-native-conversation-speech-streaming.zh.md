# Agent Note: 原生语音流式朗读严格会话回复

Status: implemented

[English](2026-10-12-native-conversation-speech-streaming.md) | 中文

## Problem

原生 Codex 语音即使面对无工具的问候，也要等待整个 Phoenix Turn 结束。即使 WebRTC 已预热，在所选模型生成后续文字时仍无法提前朗读。此等待与应用加载和首次麦克风连接不同。

## Decision

现有持久事件 `step/start.historyProjection` 的 `conversational-tail` 值只为严格会话快速路径授权逐句朗读。浏览器从真实 Step 位置派生资格，并排除带工具的输出。上下文会话与任务执行仍要求已完成的最终 Harness 回复。Codex 仍只负责语音传输；自主回复保持禁用，答案由所选 Phoenix Agent 负责。

稳定完整的句子逐步进入原生语音队列。每条消息的进度防止 Turn 结束时重复已经接纳的句子。改写、重试和中断会丢弃待播语音并取消活动输出。已经播放的声音无法撤回。此变更不缩短提供者的推理时间，也不能证明已认证环境中的端到端延迟改善。

原生生成完成时不静音媒体元素：WebRTC 可能仍在播放缓冲音频，包括整个短回答。助手的 `turn.done` 与 `response.done` 释放句子游标；用户的 `turn.done` 不能结束助手播报。只有显式中断、停止或抑制未授权输出才静音通话。按会话限定的接收防止另一个会话的渲染器将文本发送到现有通话。

Codex V3 可能为同一句语音依次发送 `response.done` 和助手 `turn.done`。第一条完成事件已开始下一句时，迟到的第二条事件不得在新回复开始前误将下一句结束。客户端在同一消息内设置短暂的重复终止事件保护：只有尚未观察到新回复开始、且事件类型与前次不同时才忽略；后续合法句子使用相同完成事件类型时仍立即推进。重复到达的 WebRTC 音频增量也沿用已在启动或播放中的 HTML 音频元素，不再反复调用 `play()`。这些优化不绕过 Harness 的语音授权门禁。

原生 Codex V3 会话配置由官方 app-server 管理，其 [Frameless 协议](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/realtime_websocket/methods_frameless_bidi.rs) 与公共 Realtime API 不同。隔离的已认证探针重现了旧版 `session.turn_detection`、公共 `session.type` 和 `session.audio.input` 导致的 `unknown_parameter`。因此原生客户端不发送 VAD 会话更新；只有旧版浏览器回复路径保留该配置。删除被拒绝的更新恢复了无协议错误的事件，但本身未证明音频 RTP 已送达。

此变更部分扩展了 [Harness 最终结果决策](../bug-fix/2026-10-08-codex-live-harness-finality.zh.md)。其任务结果权限、中断、回声过滤与自主回复抑制仍然必要；仅严格会话回复可以提前获得朗读授权。

## Alternatives considered

**启用 Realtime 自主回复。** 语音传输会独立于 Phoenix 工具、记忆和权限作答。

**朗读每个增长中的助手步骤。** 带工具的步骤之后可能还有动作，其文字可能失效。

**切换到更快的模型。** 静默改路会改变所选模型，却不能解决朗读接纳延迟。

## Consequences

严格会话回复可以在后续文字尚未生成时开始朗读。工具执行保留现有的最终结果等待。原生句子串行保持一个活动语句；中断或改写不能遗留过时的待播句子。加载性能需要独立测量和修复。

## Verification

回归覆盖必须从持久事件派生会话资格，观察 Turn 结束前的原生朗读，拒绝提前朗读带工具的内容，并覆盖最终尾部去重和中断。脚本化传输测试证明接纳顺序，不能证明真实麦克风到扬声器延迟或提供者质量。回归测试明确在前一句 `response.done` 之后发送迟到的助手 `turn.done`，确保下一句仍可播放且保持进行中。

隔离的已认证 Chromium 探针使用合成音调并静音远端扬声器，协商了 `sendrecv`，接纳授权朗读，收到 296 个音频 RTP 包，并观察到媒体时钟推进。完全静音的源没有产生入站或出站媒体，因此不能作为有效音频送达验证。修正后的探针验证原生媒体传输，不能证明人的听感、语音质量或用户麦克风延迟。V3 助手 `turn.created` 事件使用与旧版 `response.created` 相同的接纳和抑制门禁。
