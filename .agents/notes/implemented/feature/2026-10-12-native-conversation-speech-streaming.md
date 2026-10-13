# Agent Note: Native speech streams strict conversational replies

Status: implemented

English | [中文](2026-10-12-native-conversation-speech-streaming.zh.md)

## Problem

Native Codex speech waited for the whole Phoenix turn to close even for tool-free greetings. A warm WebRTC call therefore did not provide an early spoken response while the selected model generated more text. This wait is separate from application loading and the initial microphone connection.

## Decision

The existing durable `step/start.historyProjection` value `conversational-tail` authorizes sentence streaming only for the strict conversational fast path. The browser derives eligibility from the actual step location and excludes tool-bearing output. Contextual conversations and task execution continue to require the completed final harness response. Codex remains speech transport; autonomous replies remain disabled and the selected Phoenix agent owns the answer.

Stable sentences enter the native speech queue incrementally. Per-message progress prevents the closed turn tail from repeating already admitted sentences. Rewrites, retries and interruptions discard pending speech and cancel active output. Audio already played cannot be retracted. The change does not reduce provider reasoning time or prove an authenticated end-to-end latency improvement.

Native generation completion does not mute the media element: WebRTC may still be playing buffered audio, including an entire short answer. Assistant `turn.done` and `response.done` release the sentence cursor; a user `turn.done` cannot complete assistant speech. Only explicit interruption, stopping or suppression of unauthorized output mutes the call. Session-qualified admission prevents another session renderer from sending its text into an existing call.

Native Codex V3 session configuration stays with the official app-server, whose [Frameless protocol](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/realtime_websocket/methods_frameless_bidi.rs) differs from the public Realtime API. Isolated authenticated probes reproduced `unknown_parameter` for legacy `session.turn_detection`, public `session.type` and `session.audio.input`. The native client therefore sends no VAD session update; only the legacy browser response route retains that configuration. Removing the rejected update restored error-free protocol events but did not itself establish audio RTP delivery.

This partially extends the [harness finality decision](../bug-fix/2026-10-08-codex-live-harness-finality.md). Its task-result authority, interruption, echo filtering and autonomous-response suppression remain necessary; only strict conversational replies receive early speech authorization.

## Alternatives considered

**Enable autonomous Realtime replies.** The voice transport would answer independently of Phoenix tools, memory and permissions.

**Speak every growing assistant step.** A tool-bearing step can precede more actions and its text can become obsolete.

**Switch to a faster model.** A silent route change would alter the selected model without addressing the speech admission delay.

## Consequences

Strict conversational replies may begin speaking before the remaining text is generated. Tool execution retains its existing final-result wait. Native sentence serialization preserves one active utterance; interrupted or rewritten output cannot leave stale queued sentences. Loading performance requires separate measurements and fixes.

## Verification

Regression coverage must derive conversational eligibility from durable events, observe native speech before turn closure, reject early tool-bearing speech, and exercise final-tail deduplication and interruption. Scripted transport coverage proves admission ordering, not actual microphone-to-speaker latency or provider quality.

An isolated authenticated Chromium probe with a synthetic tone and a muted remote speaker negotiated `sendrecv`, accepted the authorized speech, received 296 audio RTP packets and observed the media clock advancing. A completely silent source produced no outbound or inbound media and was not a valid audio-delivery check. The corrected probe verifies native media transport, not human audibility, speech quality or the user's microphone latency. V3 assistant `turn.created` events use the same admission and suppression gates as legacy `response.created` events.
