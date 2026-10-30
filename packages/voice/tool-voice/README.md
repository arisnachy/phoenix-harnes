# @phoenix-ai/dsh-tool-voice

English | [中文](README.zh.md)

Model-facing PHOENIX speech controls for Kira. The base bundle registers the package as `tool-voice`; its two native tools are available to the model without MCP discovery.

## Tools

- `phoenix_voice_status`: read current Host speech status, including local provider and Codex Live readiness.
- `phoenix_voice_speak`: play explicitly requested speech through an already-authorized Codex Live session; otherwise synthesize on the local Host using PHOENIX Natural, Kokoro, or a matching-language Windows/platform synthesizer.

Only audio **output** is requested. These tools never request microphone permission, silently start a browser WebRTC session, or impersonate human speech input. A successful provider receipt confirms synthesis or transport acceptance, not that a speaker was physically audible.

## Configuration

Uses `PHOENIX_VOICE_ENABLED`, `PHOENIX_VOICE_LANGUAGE` (default `es-DO`), and the existing `@phoenix-ai/dsh-voice` and `@phoenix-ai/dsh-voice-local` services. Voice packages do not bundle universal model weights. The client must be restarted after installing a new bundle.

## Known limitations

When neither a local neural engine nor a system voice for the requested language is available, `phoenix_voice_speak` returns a failure receipt and does not claim to have played audio. The native Codex output path requires a pre-authorized session. Physical speaker volume and user audibility cannot be determined by a tool result.
