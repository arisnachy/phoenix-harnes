# Voice

English | [中文](README.zh.md)

The voice group adds an asynchronous local speech side channel. `dsh-voice` owns event gating, provider selection, transcription, and bounded cancellation; `dsh-voice-local` owns optional local process adapters.

| Package | Responsibility |
|---|---|
| [`voice/`](voice/) | Provider-neutral `ctx.voice` service and important-event queue |
| [`voice-local/`](voice-local/) | Optional Kokoro, platform TTS, and command-backed STT providers |

Voice never decides whether a mission, turn, or tool is complete. The execution path remains independent of audio availability and provider latency.
