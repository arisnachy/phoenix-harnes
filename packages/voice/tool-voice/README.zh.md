# @phoenix-ai/dsh-tool-voice

[English](README.md) | 中文

本插件让 Kira 在模型运行时调用 PHOENIX 的语音输出功能，而不必通过 MCP 搜索。

## 工具

- `phoenix_voice_status`：查询本地语音引擎和 Codex Live 的可用状态。
- `phoenix_voice_speak`：优先尝试已授权且处于活动状态的 Codex Live；如不可用，则使用 PHOENIX 本地语音合成服务播放指定文本。

这些工具只处理**语音输出**，不会自动开启麦克风或 WebRTC。成功响应只证明语音提供方已接受请求，并不表示用户确实听到了声音。

## 配置与限制

使用现有的 `PHOENIX_VOICE_ENABLED` 和 `PHOENIX_VOICE_LANGUAGE` 配置（默认 `es-DO`）。语音模型和特定语言的系统声音需要单独安装。如果没有可用的语音引擎，工具明确返回失败原因，不会假称已播放语音。
