# @phoenix-ai/dsh-tool-voice

[English](README.md) | 中文

本插件让 Kira 在模型运行时调用 PHOENIX 的语音输出功能，无须通过 MCP 搜索。

## Model Experience

用户要求 Kira 说话时，模型调用 `phoenix_voice_speak` 朗读简短文本；需要诊断时调用 `phoenix_voice_status`。工具如实返回服务提供方的接受或拒绝状态；未经用户确认，不得声称扬声器已经发出可听见的声音。

## Tools

- `phoenix_voice_status`：查询本地语音服务、队列以及 Codex Live 可用状态，不播放声音。
- `phoenix_voice_speak`：优先使用已授权的活动 Codex Live 会话，否则尝试本地 Host 语音合成。

## Configuration

使用 `PHOENIX_VOICE_ENABLED` 和 `PHOENIX_VOICE_LANGUAGE` 配置（默认 `es-DO`），以及现有 `@phoenix-ai/dsh-voice` 与 `@phoenix-ai/dsh-voice-local` 服务。语音模型需要单独安装；安装新版本后需要重新启动客户端。

## Known Limitations and Deferred Work

工具仅提供语音输出，不会自动开启麦克风、启动浏览器 WebRTC 或模拟语音输入。缺少已授权 Codex 会话或可用本地合成器时，工具明确返回失败。成功响应不等于扬声器确实可听。
