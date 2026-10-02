# Voice

English | [中文](README.zh.md)

The voice group adds asynchronous speech interfaces without making audio part of PHOENIX execution authority. `dsh-voice` owns event gating and provider selection; `dsh-voice-local` owns local TTS/STT fallbacks; `dsh-voice-codex` owns the authenticated Codex realtime WebRTC transport used by Kira Live.

| Package | Responsibility |
|---|---|
| [`voice/`](voice/) | Provider-neutral `ctx.voice` service, important-event queue, and realtime browser contract |
| [`voice-local/`](voice-local/) | Optional PHOENIX Natural, Kokoro, platform TTS, and command-backed STT providers |
| [`voice-codex/`](voice-codex/) | Codex CLI realtime WebRTC speech renderer for Kira Live |

Voice never decides whether a mission, turn, or tool is complete. Phoenix Auto and the selected reasoning/execution models remain authoritative; audio availability and provider latency stay outside that execution path.
