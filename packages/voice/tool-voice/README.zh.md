# @phoenix-ai/dsh-tool-voice

[English](README.md) | 中文

本插件让 Kira 在模型运行时调用 PHOENIX 的语音输出功能，无须通过 MCP 搜索。

## Model Experience

### 语音状态与朗读操作

#### What the model sees

模型可调用 `phoenix_voice_status` 查询 Host 语音功能是否可用，或调用 `phoenix_voice_speak` 请求朗读短语。结果反映服务提供方的实际接受或失败状态；未经用户确认，模型不得断言扬声器发出了可听见的声音。

#### Token effect

两个工具定义在模型可见时贡献固定的工具结构令牌。工具调用和状态结果只会将对应消息追加到后续会话历史，不会持续注入音频或麦克风流。

#### KV Cache effect

在模型路由及前文不变时，稳定的工具定义允许重用模型上下文前缀。语音状态或朗读结果追加新消息，而不是重写已有的上下文前缀。

## Tools

- `phoenix_voice_status`：查询本地语音服务、队列以及 Codex Live 可用状态，不播放声音。
- `phoenix_voice_speak`：优先使用已授权的活动 Codex Live 会话，否则尝试本地 Host 语音合成。

## Configuration

使用 `PHOENIX_VOICE_ENABLED` 和 `PHOENIX_VOICE_LANGUAGE` 配置（默认 `es-DO`），以及现有 `@phoenix-ai/dsh-voice` 与 `@phoenix-ai/dsh-voice-local` 服务。语音模型需要单独安装；安装新版本后需要重新启动客户端。

## Known Limitations and Deferred Work

工具仅提供语音输出，不会自动开启麦克风、启动浏览器 WebRTC 或模拟语音输入。缺少已授权 Codex 会话或可用本地合成器时，工具明确返回失败。成功响应不等于扬声器确实可听。
