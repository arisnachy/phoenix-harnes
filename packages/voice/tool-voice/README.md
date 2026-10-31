# @phoenix-ai/dsh-tool-voice

English | [中文](README.zh.md)

Model-facing PHOENIX speech controls for Kira. The base bundle mounts `tool-voice`, so its two native tools are available without MCP discovery.

## Tools

- `phoenix_voice_status`: read Host speech status, local provider, queue, and Codex Live readiness without playing audio.
- `phoenix_voice_speak`: play explicitly requested speech through an already-authorized Codex Live session or synthesize through the local Host provider.

## Configuration

Uses `PHOENIX_VOICE_ENABLED`, `PHOENIX_VOICE_LANGUAGE` (default `es-DO`), and the existing `@phoenix-ai/dsh-voice` and `@phoenix-ai/dsh-voice-local` services. Voice packages do not bundle universal model weights. Restart the client after installing a new bundle.

## Model Experience

### Voice status and speech actions

#### What the model sees

The model can call `phoenix_voice_status` to inspect Host speech availability or `phoenix_voice_speak` to request an audible phrase. Results describe the provider's actual acceptance or failure; the model cannot infer that sound was audible without user confirmation.

#### Token effect

The two tool definitions contribute fixed schema tokens when exposed to the model. Tool calls and their returned status add only the resulting messages to subsequent conversation history; no continuous audio or microphone stream is injected.

#### KV Cache effect

Tool definitions remain stable across turns and can reuse the same model prefix when the route and surrounding context do not change. Each status or speech result appends new message content rather than rewriting the previous prefix.

## Known Limitations and Deferred Work

- The tools provide audio output only: they never request microphone permission, start browser WebRTC silently, or impersonate speech input. Without an authorized Codex session or a suitable local synthesizer, speech returns an explicit failure. A successful provider receipt does not verify physical speaker volume or audibility.
