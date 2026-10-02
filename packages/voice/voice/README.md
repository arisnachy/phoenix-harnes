# @phoenix-ai/dsh-voice

English | [中文](README.zh.md)

Provider-neutral asynchronous voice for PHOENIX. The service accepts explicit important events and also exposes the browser-negotiated realtime speech seam used by Kira Live. Ordinary turns, tools, and progress remain silent unless a client explicitly enables hands-free conversation.

## Config

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

`announce()` returns a receipt immediately and drains important-event audio asynchronously. The queue is bounded, duplicate keys are suppressed, and `cancel()` or `stop()` aborts active and pending speech. Provider failures are contained and do not reject the execution loop. `transcribe()` uses the selected STT provider but never enters the TTS queue.

Kira Live uses `realtimeStatus`, `realtimeOpen`, `realtimeSpeak`, and `realtimeClose`. The browser supplies a WebRTC offer; the selected realtime provider returns an answer and receives only normalized assistant prose. This seam never changes the active PHOENIX model, session, tools, or completion decision.

`displayOutputToVoiceText()` is the separation point between `display_output` and `voice_output`. It removes code blocks, Markdown, URLs, HTML, emoji, visual symbols, and secret-looking values before synthesis, then applies a sentence-aware length cap.

## Providers

Providers implement `VoiceTextToSpeechProvider`, `VoiceSpeechToTextProvider`, or `VoiceRealtimeProvider` and register through the service. A configured provider id wins when available; otherwise the highest-priority available provider wins. Realtime failure falls back independently to host TTS and then the browser speech adapter.

## Model Experience

### Voice side channel

#### What the model sees

The primary PHOENIX model sees no automatic voice context. Explicit realtime providers may receive already-approved assistant prose for speech rendering, but microphone audio and provider state are not injected into the main prompt by this service.

#### Token effect

The main PHOENIX request gains zero tokens. A remote realtime speech provider can have its own provider-side usage, independent of the main reasoning turn.

#### KV Cache effect

There is no main-session cache effect; queue state, WebRTC state, and provider availability remain host/client runtime state outside model requests.

## Known Limitations and Deferred Work

- Browser microphone recognition is still a client adapter; the provider-neutral service does not choose capture hardware.
- Realtime transport availability depends on the configured provider and browser WebRTC support.
- Voice is AI-generated audio and must be disclosed by the product surface that enables it.
