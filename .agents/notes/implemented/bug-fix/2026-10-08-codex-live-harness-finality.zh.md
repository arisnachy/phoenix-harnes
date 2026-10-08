# Agent Note: Codex Live 仅朗读 Harness 已完成的结果

Status: implemented

[English](2026-10-08-codex-live-harness-finality.md) | 中文

## Problem

在 Phoenix 的 Codex Live 免提模式中，语音可能在普通 harness 仍在执行浏览器或计算机工具时，把中间步骤（例如西班牙语“sigo en ello”）朗读成任务状态。网页实际上已经打开，而语音仍报告旧的处理中状态。VAD 自主生成的回复也可能与真实结果竞争，连续 `response.create` 请求还可能重叠。

## Decision

Realtime 只负责麦克风转录与语音传输，普通 Phoenix Agent 及其工具才掌握任务真实状态。浏览器后备语音可流式朗读助手步骤；原生 Codex Live 则只朗读已经完成的 Turn 尾部，并且仅当结束状态为 `completed` 且没有后续工具结果使最后一条助手消息过时时。中间步骤、被打断的 Turn、工具执行前的旧总结都不得作为 Codex Live 的完成陈述。

每次最多允许一个明确授权的 `response.create` 进行中。其他语音（包括批准通知）排队等候 `response.done`。没有客户端请求时出现的 `response.created` 会被取消，避免某些忽略 `create_response:false` 的 VAD 自主播报。重连时仍保留已排队的最终回答，麦克风转录仍走普通输入路径。

## Alternatives considered

**朗读所有已结束的 Step：** 单个 Step 结束并不代表整个 Turn 的工具运行结束。

**允许 Live 自主报告进度：** 实时语音线程并不执行浏览器或计算机操作，不能可靠报告结果。

**认为一个成功工具结果代表整个任务完成：** 网页导航可能只是更大任务中的一个步骤。

## Consequences

中间步骤不能在整个任务完成后继续作为最终状态播报。音频要等到真实 Turn 结束，因此复杂工具运行期间可能有延迟。若最后一个工具结果之后没有可靠的助手总结，系统选择不播报，而不是凭空声称成功。外部 Realtime 服务是否完全支持取消仍需在 Windows 上通过 WebRTC 实测。

## Testing

浏览器端语音回归测试覆盖中间步骤抑制、语音请求串行、最终 harness 答案、自主 VAD 播报取消，以及仍通过普通输入路径接收语音文本。最终 Turn 渲染依据结束原因和后续工具证据决定是否允许播报。
