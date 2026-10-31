# @phoenix-ai/dsh-tool-voice

English | [中文](README.zh.md)

Model-facing PHOENIX speech controls for Kira. The base bundle mounts `tool-voice`, so its two native tools are available without MCP discovery.

## Tools

- `phoenix_voice_status`: read Host speech status, local provider, queue, and Codex Live readiness without playing audio.
- `phoenix_voice_speak`: play explicitly requested speech through an already-authorized Codex Live session or synthesize through the local Host provider.

## Configuration

Uses `PHOENIX_VOICE_ENABLED`, `PHOENIX_VOICE_LANGUAGE` (default `es-DO`), and the existing `@phoenix-ai/dsh-voice` and `@phoenix-ai/dsh-voice-local` services. Voice packages do not bundle universal model weights. Restart the client after installing a new bundle.

## Model Experience

### User-authorized speech and status checks

#### What the model sees

Kira may request `phoenix_voice_status` to inspect the configured speech provider and `phoenix_voice_speak` to speak text explicitly requested by the user. Tool responses report provider acceptance or rejection, not a guarantee that the speakers are audible.

#### Token effect

Only tool schemas, short requested text, and bounded status or playback receipts enter the model context; the audio waveform is not inserted into the conversation.

#### KV Cache effect

The static speech tool contracts remain cacheable. Dynamic provider status and playback receipts may vary per request and only affect the suffix of the context.

## Known Limitations and Deferred Work

- The tools provide audio output only: they never request microphone permission, start browser WebRTC silently, or impersonate speech input. Without an authorized Codex session or a suitable local synthesizer, speech returns an explicit failure. A successful provider receipt does not verify physical speaker volume or audibility.
