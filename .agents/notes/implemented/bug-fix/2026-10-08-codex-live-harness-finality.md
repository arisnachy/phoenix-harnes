# Agent Note: Codex Live speaks only completed harness results

Status: implemented

English | [中文](2026-10-08-codex-live-harness-finality.zh.md)

## Problem

In Phoenix hands-free Codex Live mode, the Realtime voice could announce an intermediate assistant step (for example, "sigo en ello") while the ordinary harness continued a browser or computer tool. The page could already be open while the voice still narrated an obsolete in-progress message. VAD-created autonomous responses could also compete with the actual harness result, and successive `response.create` calls could overlap.

## Decision

Realtime remains a microphone/transcription and speech transport; the ordinary Phoenix agent and its tools are the only source of task truth. Unlike browser-based fallback speech, which can stream assistant steps, native Codex Live now admits only the completed Turn tail, and only when its ending is `completed` and no newer tool/result superseded the last assistant text. Intermediate step text, interrupted turns and older pre-tool summaries never become Codex Live claims.

One explicitly authorized `response.create` may be in flight at a time. Additional speech is queued until the channel reports `response.done`, including approval notifications. Realtime `response.created` events with no client-issued speech are cancelled to suppress autonomous VAD narration that might ignore `create_response:false`. Existing channel-reconnect behavior retains queued final answers, and microphone transcripts still enter the usual composer path.

## Alternatives considered

**Let Live speak every settled step:** rejected because a settled step can precede more tool work within the same turn.

**Allow autonomous Live status updates:** rejected because the realtime speech thread does not own browser/computer tool execution and cannot truthfully report its outcomes.

**Assume every successful tool result proves overall task completion:** rejected because one successful navigation can be only one step of a longer user request.

## Consequences

The assistant no longer promises ongoing work after the harness reaches its final result because interim steps cannot be voiced as completed. Audio starts once the real harness turn ends; there may be some latency while complex tool runs execute. If a turn has no valid final assistant summary after its tool results, Phoenix prefers silence to inventing a confirmation. Native Realtime compatibility still depends on the external server honoring cancellation; actual WebRTC audio on Windows requires manual verification.

## Testing

Browser-side voice regression checks intermediate-step suppression, Live response serialization, completed harness speech, VAD-autonomous reply cancellation, and continuous transcript admission through the same composer. The final-turn renderer checks status and subsequent tool evidence before authorizing a native utterance.
