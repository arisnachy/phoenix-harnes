# Telegram ↔ Phoenix voice lifecycle

This document defines the transport contract for the future Telegram channel. It does not claim that the Telegram bot or a telephone-call transport exists yet.

- Text commands must enter the ordinary Phoenix Agent inbox. They **must not** toggle the global hands-free flag or start Codex Realtime.
- Telegram voice notes are finite audio messages: transcribe, dispatch a normal harness turn, send text (and optionally a finite spoken reply), release audio.
- A scheduled voice invitation is not an active call. Only explicit acceptance may open a consented microphone/WebRTC session using Codex app-server login.
- Every accepted live call has one owner and one stop path. Hangup, pagehide, microphone-track end, unrecoverable WebRTC failure, disconnect >30 seconds, or 5 minutes without voice events releases WebRTC, audio, microphone and the Codex sidecar thread. Ending audio **never cancels a Phoenix harness task**.
- The voice session must not silently restart on a Telegram message, delayed network callback, agent completion, or proactive notification. Subsequent notifications use text unless the user explicitly opens a new call.
- The Host expires orphaned remote Codex calls after 60 minutes even if a browser disappears silently. This is a hard safety ceiling, not a reason to cancel a harness job.
- Remote stop is best effort and must never hold the local UI in voice mode. Run cleanup synchronously before awaiting network calls.
- Deduplicate incoming Telegram updates and require an allowlisted Telegram user/chat ID. Never send OAuth cookies or Codex credentials to Telegram.
- Proactive messages have quiet hours, rate limits and user opt-out.
- Keep the native Codex ChatGPT-login voice path separate from billed API keys; report unavailable native realtime instead of claiming it is working.
