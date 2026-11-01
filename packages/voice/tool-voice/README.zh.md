# @phoenix-ai/dsh-tool-voice

[English](README.md) | 中文

本插件让 Kira 在模型运行时调用 PHOENIX 的语音输出功能，无须通过 MCP 搜索。基础组合直接加载 `tool-voice`，提供两项原生工具。

## Tools

- `phoenix_voice_status`：查询 Host 语音服务、队列以及 Codex Live 可用状态，不播放声音。
- `phoenix_voice_speak`：请求已授权 Codex Live 会话播放指定文本，或通过本地 Host 服务合成语音。

## Configuration

使用 `PHOENIX_VOICE_ENABLED`、`PHOENIX_VOICE_LANGUAGE`（默认 `es-DO`），以及现有 `@phoenix-ai/dsh-voice` 与 `@phoenix-ai/dsh-voice-local` 服务。语音模型需要单独安装；安装新版本后需要重新启动客户端。

## Model Experience

### Tool schemas

#### What the model sees

插件注册后，模型可看到 `phoenix_voice_status` 和 `phoenix_voice_speak` 两项工具的定义。具体的模型可见定义参见[生成的工具 Schema 目录](../../../docs/tool-catalog.md#phoenix-aidsh-tool-voice)。前者只读取 Host 的语音状态和队列，不播放声音；后者请求已授权服务播放用户指定的文本。工具可见不代表语音会话已连接，也不代表声音已经播放。

#### Token effect

工具可见时，两个固定的工具定义占用输入 token。仅注册工具不会将音频内容添加到提示词。

#### KV Cache effect

插件注册状态和工具可见性不变时，工具定义构成稳定的缓存前缀。工具可见性变化可能使后续缓存前缀失效。

### Tool results

#### What the model sees

调用后，模型收到 Host 返回的真实状态或播放回执，包括服务拒绝和失败信息。Kira 必须区分“播放请求被接受”与“用户确认实际听到声音”。

#### Token effect

只有调用工具后才会增加结果 token，长度随状态或播放回执变化；结果保留在会话历史中直到压缩。

#### KV Cache effect

工具结果追加到现有会话历史，不会改写先前已经缓存的提示词前缀。

## Known Limitations and Deferred Work

- 工具仅提供语音输出，不会自动开启麦克风、启动浏览器 WebRTC 或模拟语音输入。缺少已授权 Codex 会话或可用本地合成器时，工具明确返回失败。成功响应不等于扬声器确实可听。
