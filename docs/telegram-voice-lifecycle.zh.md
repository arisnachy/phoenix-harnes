# Telegram ↔ Phoenix 语音生命周期

[English](telegram-voice-lifecycle.md) | 中文

本文定义未来 Telegram 渠道的传输契约，并不宣称 Telegram 机器人或电话呼叫传输功能已经存在。

- 文本命令必须进入正常的 Phoenix Agent 收件箱，**不得**切换全局免提标志，也不得启动 Codex Realtime。
- Telegram 语音留言是有明确终点的音频消息：先转录，随后派发正常的 harness 回合，发送文本（可选择附带一段有限长度的语音回复），最后释放音频资源。
- 已排期的语音邀请不等于正在进行的通话。只有用户明确接受后，才能通过 Codex app-server 登录建立取得同意的麦克风/WebRTC 会话。
- 每次被接受的实时通话都必须只有一个所有者和一条停止路径。挂断、pagehide、麦克风轨道结束、无法恢复的 WebRTC 故障、断线超过 30 秒或 5 分钟没有语音事件时，必须释放 WebRTC、音频、麦克风和 Codex sidecar 线程。结束音频**绝不取消 Phoenix harness 任务**。
- 收到 Telegram 消息、迟到的网络回调、Agent 完成任务或主动通知时，语音会话不得暗中重启。后续通知使用文字，除非用户明确打开新通话。
- 即使浏览器悄然消失，Host 也必须在 60 分钟后终止无人所有的远程 Codex 通话。这是强制安全上限，不是取消 harness 任务的理由。
- 远程停止属于尽力执行，不得让本地 UI 一直停留在语音模式。必须先同步执行本地清理，再等待网络调用。
- 需要对传入 Telegram 更新去重，并要求 Telegram 用户或聊天 ID 位于许可列表中。绝不能通过 Telegram 发送 OAuth Cookie 或 Codex 凭据。
- 主动消息必须遵守免打扰时段、速率限制和用户退出选择。
- 原生 Codex ChatGPT 登录语音通道必须与按使用量计费的 API 密钥分开；原生实时功能不可用时要如实报告，不得声称其正常运行。
