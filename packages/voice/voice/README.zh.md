# @phoenix-ai/dsh-voice

[English](README.md) | 中文

与 provider 无关的 PHOENIX 异步语音服务。该服务只接受明确的重要事件：已验证的任务完成、相关发现、真实阻塞、帮助请求和授权请求。普通轮次、工具和进度保持静默。

## 配置

```yaml
- id: voice
  name: '@phoenix-ai/dsh-voice'
  config:
    enabled: true
    language: es-DO
    maxQueue: 3
    maxChars: 480
    ttsProvider: kokoro
```

`announce()` 会立即返回 receipt，并异步排空音频。队列有界，重复 key 会被抑制，`cancel()` 或 `stop()` 可以取消进行中和等待中的语音。provider 失败会被隔离，不会拒绝执行循环。`transcribe()` 使用选定的 STT provider，但不会进入 TTS 队列。

`displayOutputToVoiceText()` 是 `display_output` 与 `voice_output` 的分离点。它在合成前移除代码块、Markdown、URL、HTML、emoji、视觉符号和疑似 secret 的值，然后应用按句子处理的长度上限。

## Provider

Provider 实现 `VoiceTextToSpeechProvider` 或 `VoiceSpeechToTextProvider`，并通过服务注册。配置的 provider id 在可用时优先；否则选择优先级最高的可用 provider。本地 provider 包在配置 `PHOENIX_KOKORO_COMMAND` 时注册 Kokoro，并可注册平台语音 fallback。

## Model Experience

### 语音旁路

#### What the model sees

模型看不到自动语音上下文。明确的 consumer 可以使用 `VoiceImportantEvent` 发出 `voice/important`；音频不会加入提示上下文。

#### Token effect

语音不会增加模型 token，因为规范化、事件筛选和播放都在循环之外运行。

#### KV Cache effect

没有缓存影响；队列状态和 provider 可用性属于模型请求之外的主机运行时状态。

## 已知限制与暂缓事项

- 服务不提供模型权重或通用 Kokoro 命令；部署必须提供本地命令及其参数。
- 浏览器麦克风采集仍是独立的 client 适配器；配置本地命令后才提供 host STT。
- 语音是 AI 生成的音频，启用它的产品界面必须进行披露。
