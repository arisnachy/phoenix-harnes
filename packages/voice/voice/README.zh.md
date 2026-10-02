# @phoenix-ai/dsh-voice

[English](README.md) | 中文

与 provider 无关的 PHOENIX 异步语音服务。该服务接受明确的重要事件，并暴露 Kira Live 使用的浏览器协商 realtime 语音接口。普通轮次、工具和进度保持静默，除非 client 明确启用免手操作对话。

## 配置

```yaml
- id: voice
  name: '@phoenix-ai/dsh-voice'
  config:
    enabled: true
    language: es-DO
    maxQueue: 3
    maxChars: 480
    ttsProvider: phoenix-natural
    realtimeProvider: codex-realtime
```

`announce()` 会立即返回 receipt，并异步排空重要事件音频。队列有界，重复 key 会被抑制，`cancel()` 或 `stop()` 可取消进行中和等待中的语音。provider 失败会被隔离，不会拒绝执行循环。`transcribe()` 使用选定的 STT provider，但不会进入 TTS 队列。

Kira Live 使用 `realtimeStatus`、`realtimeOpen`、`realtimeSpeak` 和 `realtimeClose`。浏览器提供 WebRTC offer；选定的 realtime provider 返回 answer，并且只接收已经规范化的 assistant 文本。该接口不会改变活动的 PHOENIX 模型、session、工具或完成判定。

`displayOutputToVoiceText()` 是 `display_output` 与 `voice_output` 的分离点。它在合成前移除代码块、Markdown、URL、HTML、emoji、视觉符号和疑似 secret 的值，然后应用按句子处理的长度上限。

## Provider

Provider 实现 `VoiceTextToSpeechProvider`、`VoiceSpeechToTextProvider` 或 `VoiceRealtimeProvider`，并通过服务注册。配置的 provider id 在可用时优先；否则选择优先级最高的可用 provider。realtime 失败会独立 fallback 到 host TTS，最后回到浏览器语音适配器。

## Model Experience

### 语音旁路

#### What the model sees

主 PHOENIX 模型看不到自动语音上下文。明确的 realtime provider 可以接收已经批准的 assistant 文本用于语音渲染，但本服务不会把麦克风音频或 provider 状态注入主提示。

#### Token effect

主 PHOENIX 请求不会增加 token。远程 realtime 语音 provider 可以产生独立于主推理轮次的 provider 侧用量。

#### KV Cache effect

主 session 的缓存不受影响；队列状态、WebRTC 状态和 provider 可用性都保留在模型请求之外的 host/client 运行时中。

## 已知限制与暂缓事项

- 浏览器麦克风识别仍属于 client 适配器；provider-neutral 服务不选择采集硬件。
- realtime 传输可用性取决于配置的 provider 和浏览器 WebRTC 支持。
- 语音是 AI 生成的音频，启用它的产品界面必须进行披露。
