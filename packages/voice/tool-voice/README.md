# @phoenix-ai/dsh-tool-voice

English | [中文](README.zh.md)

Model-facing PHOENIX speech controls for Kira. The base bundle mounts `tool-voice`, so its two native tools are available without MCP discovery.

## Tools

- `phoenix_voice_status`: read Host speech status, local provider, queue, and Codex Live readiness without playing audio.
- `phoenix_voice_speak`: play explicitly requested speech through an already-authorized Codex Live session or synthesize through the local Host provider.

## Configuration

Uses `PHOENIX_VOICE_ENABLED`, `PHOENIX_VOICE_LANGUAGE` (default `es-DO`), and the existing `@phoenix-ai/dsh-voice` and `@phoenix-ai/dsh-voice-local` services. Voice packages do not bundle universal model weights. Restart the client after installing a new bundle.

## Model Experience

### Model-invoked speech controls

#### What the model sees

When a user asks Kira to speak, the model can call `phoenix_voice_speak` with a short phrase. `phoenix_voice_status` reports the current Host voice status. Tool receipts identify whether the provider accepted the request, but not whether physical speakers were audible; Kira asks the user to confirm playback.

#### Token effect

The two tool schemas add a bounded amount of model context. Voice synthesis and playback run in the Host and do not insert audio bytes into the conversation prompt.

#### KV Cache effect

The tool schemas and static instructions remain reusable across requests. Live provider status and playback receipts vary per call and may reduce KV-cache reuse for those dynamic tool results.

## Known Limitations and Deferred Work

- The tools provide audio output only: they never request microphone permission, start browser WebRTC silently, or impersonate speech input. Without an authorized Codex session or a suitable local synthesizer, speech returns an explicit failure. A successful provider receipt does not verify physical speaker volume or audibility.
