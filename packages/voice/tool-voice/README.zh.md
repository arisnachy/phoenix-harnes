# @phoenix-ai/dsh-tool-voice

[English](README.md) | 中文

本插件让 Kira 在模型运行时调用 PHOENIX 的语音输出功能，无须通过 MCP 搜索。

## Tools

- `phoenix_voice_status`：查询本地语音服务、队列以及 Codex Live 可用状态，不播放声音。
- `phoenix_voice_speak`：优先使用已授权的活动 Codex Live 会话，否则尝试本地 Host 语音合成。

## Configuration

使用 `PHOENIX_VOICE_ENABLED` 和 `PHOENIX_VOICE_LANGUAGE` 配置（默认 `es-DO`），以及现有 `@phoenix-ai/dsh-voice` 与 `@phoenix-ai/dsh-voice-local` 服务。语音模型需要单独安装；安装新版本后需要重新启动客户端。

## Model Experience

### 用户授权的语音与状态查询

#### What the model sees

Kira 可以使用 `phoenix_voice_status` 查询已配置的语音服务，并在用户明确要求朗读时调用 `phoenix_voice_speak`。工具结果仅反映服务商接受或拒绝请求，不保证扬声器已经发出可听声音。

#### Token effect

模型上下文中仅包含工具的静态定义、简短的用户指定文字以及有限的状态和播放回执；音频波形不会自动加入对话。

#### KV Cache effect

静态语音工具定义可以复用缓存。服务状态与播放回执会随请求变化，但只影响动态上下文部分。

## Known Limitations and Deferred Work

- 工具仅提供语音输出，不会自动开启麦克风、启动浏览器 WebRTC 或模拟语音输入。缺少已授权 Codex 会话或可用本地合成器时，工具明确返回失败。成功响应不等于扬声器确实可听。
