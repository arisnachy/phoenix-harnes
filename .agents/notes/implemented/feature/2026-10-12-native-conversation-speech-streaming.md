# Agent Note: Native speech streams strict conversational replies

Status: implemented

English | [中文](2026-10-12-native-conversation-speech-streaming.zh.md)

## Problem

Native Codex speech waited for the whole Phoenix turn to close even for tool-free greetings. A warm WebRTC call therefore did not provide an early spoken response while the selected model generated more text. This wait is separate from application loading and the initial microphone connection.

## Decision

The existing durable `step/start.historyProjection` value `conversational-tail` authorizes sentence streaming only for the strict conversational fast path. The browser derives eligibility from the actual step location and excludes tool-bearing output. Contextual conversations and task execution continue to require the completed final harness response. Codex remains speech transport; autonomous replies remain disabled and the selected Phoenix agent owns the answer.

Stable sentences enter the native speech queue incrementally. Per-message progress prevents the closed turn tail from repeating already admitted sentences. Rewrites, retries and interruptions discard pending speech and cancel active output. Audio already played cannot be retracted. The change does not reduce provider reasoning time or prove an authenticated end-to-end latency improvement.

Native generation completion does not mute the media element: WebRTC may still be playing buffered audio, including an entire short answer. Assistant `turn.done` and `response.done` release the sentence cursor; a user `turn.done` cannot complete assistant speech. Only explicit interruption, stopping or suppression of unauthorized output mutes the call. Session-qualified admission prevents another session renderer from sending its text into an existing call.

Codex V3 may emit a `response.done` and an assistant `turn.done` for one generated sentence. When the first completion admits the next sentence, a late second event must not finish that new sentence before its own response starts. The client keeps a short, same-message completion guard that ignores a different-shaped terminal only until a new response start is observed; successive legitimate sentences with the same terminal shape still advance immediately. Repeated WebRTC audio-delta notifications also reuse the pending or playing HTML audio element rather than invoking overlapping `play()` attempts. Neither change bypasses the harness speech-authorization gate.

Native Codex V3 session configuration stays with the official app-server, whose [Frameless protocol](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/realtime_websocket/methods_frameless_bidi.rs) differs from the public Realtime API. Isolated authenticated probes reproduced `unknown_parameter` for legacy `session.turn_detection`, public `session.type` and `session.audio.input`. The native client therefore sends no VAD session update; only the legacy browser response route retains that configuration. Removing the rejected update restored error-free protocol events but did not itself establish audio RTP delivery.

This partially extends the [harness finality decision](../bug-fix/2026-10-08-codex-live-harness-finality.md). Its task-result authority, interruption, echo filtering and autonomous-response suppression remain necessary; only strict conversational replies receive early speech authorization.

## Alternatives considered

**Enable autonomous Realtime replies.** The voice transport would answer independently of Phoenix tools, memory and permissions.

**Speak every growing assistant step.** A tool-bearing step can precede more actions and its text can become obsolete.

**Switch to a faster model.** A silent route change would alter the selected model without addressing the speech admission delay.

Native Live used to suppress every microphone transcript throughout the full six-second WebRTC playback drain, so a natural spoken reply to Kira's question could be lost. Now the input command path reopens after a brief 900 ms echo guard once native generation ends, without shortening the independent speaker drain. An overlap with the last spoken answer is not treated as echo once that native command path has reopened; while Kira is actually generating speech, feedback suppression remains active.

Native Live replies are queued as their own conversation turns even if the previous harness turn has not finished settling. Automatically steering such a reply could cancel the prior turn and display "Stopped" when the user was merely answering a question. Explicit Stop and keyboard Steer remain available, and browser fallback's active-turn behavior is unchanged. The tradeoff is that a new native voice order during a genuinely busy task waits in the harness queue rather than implicitly cancelling it.

## Consequences

Strict conversational replies may begin speaking before the remaining text is generated. Tool execution retains its existing final-result wait. Native sentence serialization preserves one active utterance; interrupted or rewritten output cannot leave stale queued sentences. Loading performance requires separate measurements and fixes.

## Verification

Regression coverage must derive conversational eligibility from durable events, observe native speech before turn closure, reject early tool-bearing speech, and exercise final-tail deduplication and interruption. Scripted transport coverage proves admission ordering, not actual microphone-to-speaker latency or provider quality. A regression explicitly sends a delayed assistant `turn.done` after `response.done` for the preceding sentence and verifies that the next sentence remains audible and in flight.

An isolated authenticated Chromium probe with a synthetic tone and a muted remote speaker negotiated `sendrecv`, accepted the authorized speech, received 296 audio RTP packets and observed the media clock advancing. A completely silent source produced no outbound or inbound media and was not a valid audio-delivery check. The corrected probe verifies native media transport, not human audibility, speech quality or the user's microphone latency. V3 assistant `turn.created` events use the same admission and suppression gates as legacy `response.created` events.
