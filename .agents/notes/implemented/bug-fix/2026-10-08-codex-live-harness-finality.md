# Agent Note: Codex Live speaks only completed harness results

Status: implemented

English | [中文](2026-10-08-codex-live-harness-finality.zh.md)

## Problem

In Phoenix hands-free Codex Live mode, the Realtime voice could announce an intermediate assistant step (for example, "sigo en ello") while the ordinary harness continued a browser or computer tool. The page could already be open while the voice still narrated an obsolete in-progress message. VAD-created autonomous responses could also compete with the actual harness result, and successive `response.create` calls could overlap. Multiple transcript-final event formats could forward the same user speech twice; the composer submitted every transcript as `queue` even while the harness was running, leading to a growing queue of repeated voice orders.

## Decision

Realtime remains a microphone/transcription and speech transport; the ordinary Phoenix agent and its tools are the only source of task truth. Unlike browser-based fallback speech, which can stream assistant steps, native Codex Live now admits only the completed Turn tail, and only when its ending is `completed` and no newer tool/result superseded the last assistant text. Intermediate step text, interrupted turns and older pre-tool summaries never become Codex Live claims.

One explicitly authorized `response.create` may be in flight at a time. Additional speech is queued until the channel reports `response.done`, including approval notifications. Realtime `response.created` events with no client-issued speech are cancelled to suppress autonomous VAD narration that might ignore `create_response:false`. Existing channel-reconnect behavior retains queued final answers. One WebRTC call now deduplicates normalized final transcripts across Codex event formats for a bounded seven-second window, and excludes microphone echo before forwarding to the ordinary composer. Voice interruptions in an already-running ordinary harness turn submit as `steer` instead of filling the deferred queue; typed message queue choices and subagent behavior are unchanged. Received Realtime audio is muted until an explicitly issued harness response is acknowledged with `response.created`, and remuted on completion or interruption, so an unapproved autonomous voice response cannot leak through before cancellation.

## Alternatives considered

**Let Live speak every settled step:** rejected because a settled step can precede more tool work within the same turn.

**Allow autonomous Live status updates:** rejected because the realtime speech thread does not own browser/computer tool execution and cannot truthfully report its outcomes.

**Assume every successful tool result proves overall task completion:** rejected because one successful navigation can be only one step of a longer user request.

**Queue every spoken final fragment:** rejected because cross-protocol duplicate finals or background speech can build a backlog unrelated to distinct human instructions.

**Always mute the microphone while running:** rejected because genuine user interruptions should steer the same executing harness, without silently ignoring speech.

## Consequences

The assistant no longer promises ongoing work after the harness reaches its final result because interim steps cannot be voiced as completed. Audio starts once the real harness turn ends; there may be some latency while complex tool runs execute. If a turn has no valid final assistant summary after its tool results, Phoenix prefers silence to inventing a confirmation. A repeated human command inside the short transcript deduplication window may require a pause before it can be repeated intentionally. Native Realtime compatibility still depends on the external server honoring cancellation; actual WebRTC audio on Windows requires manual verification.

## Testing

Browser-side voice regression checks intermediate-step suppression, Live response serialization, completed harness speech, VAD-autonomous reply cancellation, and continuous transcript admission through the same composer. The final-turn renderer checks status and subsequent tool evidence before authorizing a native utterance. Additional browser tests cover duplicate user transcript finals, speaker muting until authorized output, and running-turn voice steering without queue buildup.
