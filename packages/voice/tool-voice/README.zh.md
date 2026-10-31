# @phoenix-ai/dsh-tool-voice

[English](README.md) | 中文

本插件让 Kira 在模型运行时调用 PHOENIX 的语音输出功能，无须通过 MCP 搜索。

## Model Experience

### 明确请求的语音输出与诊断工具

#### What the model sees

用户明确要求语音回答时，模型可以调用 `phoenix_voice_speak`；诊断语音服务时可以调用 `phoenix_voice_status`。工具返回服务提供方的接受或失败状态，并不证明扬声器实际可听。未经用户确认，Kira 不得声称已经听到声音。

#### Token effect

工具定义在注册到模型可用工具列表时占用上下文 token。调用 `phoenix_voice_status` 或 `phoenix_voice_speak` 的参数与返回状态也会进入对话上下文；本地音频合成本身不增加模型 token。

#### KV Cache effect

工具定义未变化时可复用模型上下文前缀缓存。每次工具调用及其状态消息会延长对话上下文，并可能影响后续缓存复用；音频播放和本地服务队列状态不进入模型 KV 缓存。

## Tools

- `phoenix_voice_status`：查询本地语音服务、队列以及 Codex Live 可用状态，不播放声音。
- `phoenix_voice_speak`：优先使用已授权的活动 Codex Live 会话，否则尝试本地 Host 语音合成。

## Configuration

使用 `PHOENIX_VOICE_ENABLED` 和 `PHOENIX_VOICE_LANGUAGE` 配置（默认 `es-DO`），以及现有 `@phoenix-ai/dsh-voice` 与 `@phoenix-ai/dsh-voice-local` 服务。语音模型需要单独安装；安装新版本后需要重新启动客户端。

## Known Limitations and Deferred Work

工具仅提供语音输出，不会自动开启麦克风、启动浏览器 WebRTC 或模拟语音输入。缺少已授权 Codex 会话或可用本地合成器时，工具明确返回失败。成功响应不等于扬声器确实可听。
