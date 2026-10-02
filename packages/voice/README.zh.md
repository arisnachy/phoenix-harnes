# Voice

[English](README.md) | 中文

voice 组提供异步语音接口，但音频不属于 PHOENIX 的执行权威。`dsh-voice` 负责事件筛选和 provider 选择；`dsh-voice-local` 负责本地 TTS/STT fallback；`dsh-voice-codex` 负责 Kira Live 使用的已认证 Codex realtime WebRTC 传输。

| 包 | 职责 |
|---|---|
| [`voice/`](voice/) | 与 provider 无关的 `ctx.voice` 服务、重要事件队列和 realtime 浏览器契约 |
| [`voice-local/`](voice-local/) | 可选的 PHOENIX Natural、Kokoro、平台 TTS 和命令驱动 STT provider |
| [`voice-codex/`](voice-codex/) | Kira Live 的 Codex CLI realtime WebRTC 语音渲染器 |

语音永远不会决定任务、轮次或工具是否完成。Phoenix Auto 以及所选的推理/执行模型仍是权威；音频可用性和 provider 延迟保持在执行路径之外。
