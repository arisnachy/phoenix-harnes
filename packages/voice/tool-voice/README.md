# @phoenix-ai/dsh-tool-voice

English | [中文](README.zh.md)

Model-facing PHOENIX speech controls for Kira. The base bundle mounts `tool-voice`, so its two native tools are available without MCP discovery.

## Tools

- `phoenix_voice_status`: read Host speech status, local provider, queue, and Codex Live readiness without playing audio.
- `phoenix_voice_speak`: play explicitly requested speech through an already-authorized Codex Live session or synthesize through the local Host provider.

## Configuration

Uses `PHOENIX_VOICE_ENABLED`, `PHOENIX_VOICE_LANGUAGE` (default `es-DO`), and the existing `@phoenix-ai/dsh-voice` and `@phoenix-ai/dsh-voice-local` services. Voice packages do not bundle universal model weights. Restart the client after installing a new bundle.

## Model Experience

### Tool schemas

#### What the model sees

The model sees the `phoenix_voice_status` and `phoenix_voice_speak` tool definitions when this plugin is registered. `phoenix_voice_status` reads Host voice availability and queue state without playing audio. `phoenix_voice_speak` requests playback of explicit text through an authorized provider; tool availability alone does not imply a live session or audible output.

#### Token effect

Both tool schemas contribute a fixed input-token cost while visible. No audio content is inserted into the prompt merely by registering these tools.

#### KV Cache effect

The tool definitions are prefix-stable while the registered plugin and tool visibility remain unchanged. Changes to tool visibility may invalidate reuse from the changed definition.

### Tool results

#### What the model sees

After a call, the model receives the Host's actual status or playback receipt, including provider rejection and failure details. Kira must distinguish an accepted playback request from audio confirmed audible by the user.

#### Token effect

Results add variable output tokens only after a tool call; status and playback receipts remain in the session history until compaction.

#### KV Cache effect

Tool results append to the existing conversation history and do not alter previously cached prompt-prefix tokens.

## Known Limitations and Deferred Work

- The tools provide audio output only: they never request microphone permission, start browser WebRTC silently, or impersonate speech input. Without an authorized Codex session or a suitable local synthesizer, speech returns an explicit failure. A successful provider receipt does not verify physical speaker volume or audibility.
