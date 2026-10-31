# @phoenix-ai/dsh-tool-voice

English | [中文](README.zh.md)

Model-facing PHOENIX speech controls for Kira. The base bundle mounts `tool-voice`, so its two native tools are available without MCP discovery.

## Tools

- `phoenix_voice_status`: read Host speech status, local provider, queue, and Codex Live readiness without playing audio.
- `phoenix_voice_speak`: play explicitly requested speech through an already-authorized Codex Live session or synthesize through the local Host provider.

## Configuration

Uses `PHOENIX_VOICE_ENABLED`, `PHOENIX_VOICE_LANGUAGE` (default `es-DO`), and the existing `@phoenix-ai/dsh-voice` and `@phoenix-ai/dsh-voice-local` services. Voice packages do not bundle universal model weights. Restart the client after installing a new bundle.

## Model Experience

### Explicit speech and diagnostic tools

#### What the model sees

For a user-requested spoken response, the model may call `phoenix_voice_speak` with a short phrase; for diagnostics, it may call `phoenix_voice_status`. The tool response reports provider acceptance or failure, not verified physical audibility. Kira must ask the user to confirm whether sound was heard rather than infer it from a successful receipt.

#### Token effect

The tool definitions contribute tokens when registered in the model's available tools. A call to `phoenix_voice_status` or `phoenix_voice_speak` also adds its arguments and returned status to the conversation; local audio synthesis does not itself add model tokens.

#### KV Cache effect

The registered tool definitions may reuse a cached model-context prefix while unchanged. Individual calls and their status messages extend the conversation context and can affect later cache reuse; audio playback and local provider queue state remain outside the model's KV cache.

## Known Limitations and Deferred Work

- The tools provide audio output only: they never request microphone permission, start browser WebRTC silently, or impersonate speech input. Without an authorized Codex session or a suitable local synthesizer, speech returns an explicit failure. A successful provider receipt does not verify physical speaker volume or audibility.
