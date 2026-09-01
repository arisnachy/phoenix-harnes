# @phoenix-ai/dsh-voice

English | [中文](README.zh.md)

Provider-neutral asynchronous voice for PHOENIX. The service accepts only explicit important events: verified mission completion, relevant discoveries, real blocks, help requests, and authorization requests. Ordinary turns, tools, and progress remain silent.

## Config

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

`announce()` returns a receipt immediately and drains audio asynchronously. The queue is bounded, duplicate keys are suppressed, and `cancel()` or `stop()` aborts active and pending speech. Provider failures are contained and do not reject the execution loop. `transcribe()` uses the selected STT provider but never enters the TTS queue.

`displayOutputToVoiceText()` is the separation point between `display_output` and `voice_output`. It removes code blocks, Markdown, URLs, HTML, emoji, visual symbols, and secret-looking values before synthesis, then applies a sentence-aware length cap.

## Providers

Providers implement `VoiceTextToSpeechProvider` or `VoiceSpeechToTextProvider` and register through the service. A configured provider id wins when available; otherwise the highest-priority available provider wins. The local provider package registers Kokoro when `PHOENIX_KOKORO_COMMAND` is configured and a platform speech fallback when enabled.

## Model Experience

### Voice side channel

#### What the model sees

The model sees no automatic voice context. An explicit consumer may emit `voice/important` with `VoiceImportantEvent`; audio is not added to prompt context.

#### Token effect

Voice adds zero model tokens because normalization, event gating, and playback run off-loop.

#### KV Cache effect

There is no cache effect; queue state and provider availability remain host runtime state outside model requests.

## Known Limitations and Deferred Work

- The service does not ship model weights or a universal Kokoro command; deployment supplies a local command and its arguments.
- Browser microphone capture remains an independent client adapter; host STT is available when a local command is configured.
- Voice is AI-generated audio and must be disclosed by the product surface that enables it.
