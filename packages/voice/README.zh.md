# Voice

[English](README.md) | 中文

voice 组提供异步本地语音旁路。`dsh-voice` 负责事件筛选、provider 选择、转写和有界取消；`dsh-voice-local` 负责可选的本地进程适配器。

| 包 | 职责 |
|---|---|
| [`voice/`](voice/) | 与 provider 无关的 `ctx.voice` 服务和重要事件队列 |
| [`voice-local/`](voice-local/) | 可选的 Kokoro、平台 TTS 和命令驱动 STT provider |

语音永远不会决定任务、轮次或工具是否完成。执行路径与音频可用性和 provider 延迟保持独立。
