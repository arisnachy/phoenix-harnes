# Agent Note: First-run authentication, voice execution, and mailbox recovery

Status: implemented

English | [中文](2026-10-04-first-run-auth-voice-mail-recovery.zh.md)

## Problem

A clean Phoenix composition exposed Codex model plumbing without mounting the native ChatGPT account owner, so Settings could present OpenAI API configuration while the subscription-backed Codex route had no first-run authorization action. OAuth attempts also treated a provider-closing consent popup as cancellation even though the Host could still be exchanging the callback code. Native realtime voice mirrored its own transcript directly into Session events instead of waking the live Phoenix Agent, bypassing the normal harness. AgentMail deliberately parked ambiguous signup but exposed only recovery of the possibly created mailbox, leaving no explicit way to choose a new mailbox after reinstall or an uncertain provider result.

## Decision

The base bundle mounts the native Codex account provider and lists the `openai-codex` route before generic cloud routes; Settings identifies OpenAI Codex as OAuth/Auth and keeps OpenAI Platform API-key configuration separate. The OAuth browser owns popup presentation only: closing the consent tab never cancels the Host attempt, and only the explicit Cancel action invokes cancellation while status polling continues to a terminal backend result.

A finalized Codex realtime user transcript resolves the exact live Phoenix Agent and enters its ordinary follow-up inbox. That Agent remains the single planner and executor, so tools, hardness policies, persistence, verification, and chat output follow the same path as typed input. The browser realtime channel disables VAD-created autonomous responses and renders the finalized Phoenix assistant response as audio; standalone voice compositions without a live Agent retain transcript journaling as a compatibility fallback.

Ambiguous AgentMail signup remains non-retriable automatically, but the owner can explicitly choose **Crear otro buzón**. That action keeps the enrollment marked ambiguous while it performs one fresh signup with a new generated mailbox name, preventing the automatic first-run pump from racing the deliberate second attempt; advanced recovery remains available when preserving the earlier mailbox is preferable.

## Alternatives considered

Treating Codex as another OpenAI API-key provider was rejected because native Codex authentication is owned by the ChatGPT/Codex session and must not fall through to `OPENAI_API_KEY`. Inferring OAuth cancellation from popup closure was rejected because successful providers commonly close the popup before the Host finishes token exchange. Keeping realtime as a second conversational agent was rejected because its direct transcript events bypass Phoenix tools and can disagree with actual execution. Automatically repeating ambiguous mailbox signup was rejected because an unknown provider result may already have created a usable mailbox.

## Consequences

Fresh installations expose native Codex authorization without requiring manual plugin composition, while OpenRouter remains available as a separate route. OAuth connectors survive normal provider popup closure. Spoken requests execute through the resident harness and completed harness answers return through native realtime audio instead of creating a parallel source of truth. Mailbox recovery preserves the safe no-automatic-duplicate rule while adding an explicit owner-controlled second-mailbox path. Regression tests pin popup lifecycle, realtime Agent dispatch and audio handoff, and deliberate AgentMail replacement after ambiguity.
