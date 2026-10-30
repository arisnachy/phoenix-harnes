# @phoenix-ai/dsh-tool-voice

[English](README.md) | 中文

本插件让 Kira 在模型运行时调用 PHOENIX 的语音输出功能，无须通过 MCP 搜索。基础组合默认挂载 `tool-voice`。

## Tools

- `phoenix_voice_status`：查询 Host 语音服务、队列和 Codex Live 可用状态，不播放声音。
- `phoenix_voice_speak`：优先使用已授权的活动 Codex Live 会话，否则尝试本地 Host 语音合成。

## Configuration

使用 `PHOENIX_VOICE_ENABLED` 和 `PHOENIX_VOICE_LANGUAGE` 配置（默认 `es-DO`），以及现有 `@phoenix-ai/dsh-voice` 与 `@phoenix-ai/dsh-voice-local` 服务。语音模型需要单独安装；安装新版本后需要重新启动客户端。

## Model Experience

### 模型调用的语音控制

#### What the model sees

用户要求 Kira 说话时，模型可调用 `phoenix_voice_speak` 朗读简短文本；`phoenix_voice_status` 返回 Host 当前语音状态。工具响应只证明提供方是否接受请求，不能证明扬声器发出了可听见的声音；Kira 必须向用户确认。

#### Token effect

两个工具的固定模式仅增加有限的模型上下文。语音合成和播放由 Host 执行，音频字节不会写入对话提示词。

#### KV Cache effect

固定工具模式和指令可以跨请求复用。提供方状态与播放结果是动态数据，可能降低这些工具结果部分的 KV 缓存复用率。

## Known Limitations and Deferred Work

- 工具仅提供语音输出，不会自动开启麦克风、启动浏览器 WebRTC 或模拟语音输入。缺少已授权 Codex 会话或可用本地合成器时，工具明确返回失败。成功响应不等于扬声器确实可听。
