# @phoenix-ai/dsh-tool-voice

English | [中文](README.zh.md)

Model-facing PHOENIX speech controls for Kira. The base bundle mounts `tool-voice`, so its two native tools are available without MCP discovery.

## Tools

- `phoenix_voice_status`: read Host speech status, local provider, queue, and Codex Live readiness without playing audio.
- `phoenix_voice_speak`: play explicitly requested speech through an already-authorized Codex Live session or synthesize through the local Host provider.

## Configuration

Uses `PHOENIX_VOICE_ENABLED`, `PHOENIX_VOICE_LANGUAGE` (default `es-DO`), and the existing `@phoenix-ai/dsh-voice` and `@phoenix-ai/dsh-voice-local` services. Voice packages do not bundle universal model weights. Restart the client after installing a new bundle.

## Model Experience

When a user asks Kira to speak, the model calls `phoenix_voice_speak` with the requested short phrase. For diagnosis it calls `phoenix_voice_status`. The tool reports the provider's actual acceptance or rejection; Kira must not claim the speakers were audible until the user confirms.

## Known Limitations and Deferred Work

- The tools provide audio output only: they never request microphone permission, start browser WebRTC silently, or impersonate speech input. Without an authorized Codex session or a suitable local synthesizer, speech returns an explicit failure. A successful provider receipt does not verify physical speaker volume or audibility.
