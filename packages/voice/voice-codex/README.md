# @phoenix-ai/dsh-voice-codex

English | [中文](README.zh.md)

Host-only Codex CLI realtime speech transport for PHOENIX Kira Live. It reuses the locally authenticated Codex installation and its experimental `thread/realtime/*` app-server API to negotiate browser WebRTC audio. Phoenix remains the reasoning and execution authority.

## Config

```yaml
- id: voice-codex
  name: '@phoenix-ai/dsh-voice-codex'
  config:
    enabled: true
    command: codex
    model: null
    voice: null
    requestTimeoutMs: 15000
```

The adapter starts one capability-reduced Codex `app-server` lazily, requests an ephemeral thread, negotiates a receive-only WebRTC session, and sends only PHOENIX assistant prose through `thread/realtime/appendSpeech`. It sets `clientManagedHandoffs`, disables startup context, and gives the realtime session a renderer-only instruction so it does not become a second agent.

The browser receives the remote SDP answer and audio directly over WebRTC. Codex credentials, OAuth state, and `CODEX_HOME` remain on the Host and are never returned to the browser. Windows process teardown kills the complete app-server process tree.

`PHOENIX_CODEX_VOICE=0` disables this provider. `PHOENIX_CODEX_COMMAND`, `PHOENIX_CODEX_REALTIME_MODEL`, and `PHOENIX_CODEX_VOICE_NAME` optionally override the command or Codex-advertised realtime defaults. Omitting model and voice intentionally lets the installed Codex release choose its current defaults.

## Model Experience

### Kira Live speech renderer

#### What the model sees

The ordinary PHOENIX reasoning/execution models see no additional prompt content. The Codex realtime speech session sees only renderer instructions plus normalized assistant prose handed to `appendSpeech`; it receives no PHOENIX tools, startup context, or task authority through this adapter.

#### Token effect

The main PHOENIX turn gains zero prompt tokens. Codex realtime audio rendering can consume separate provider-side realtime usage.

#### KV Cache effect

The primary PHOENIX session cache is unchanged. The ephemeral realtime thread is transport state and is discarded when the Kira Live session closes or the Host exits.

## Known Limitations and Deferred Work

- Codex marks `thread/realtime/*` experimental, so the adapter capability-probes and must evolve with upstream protocol changes.
- Kira Live requires a locally authenticated Codex CLI and browser WebRTC. If either is unavailable, PHOENIX falls back to PHOENIX Natural and browser speech.
- Microphone speech recognition remains the existing browser adapter. Moving microphone audio and transcription fully onto Codex realtime is intentionally deferred until the upstream realtime event contract is stable enough for durable input semantics.
