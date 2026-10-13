# Agent Note: HARDNESS mailbox recovery and asset contracts

Status: implemented

English | [中文](2026-10-13-hardness-diagnostic-repairs.zh.md)

## Problem

The supplied diagnostic reproduced missing asset provenance for abstract games, a false negative for chained media playback, internal connector names in visible Devpost installation output, and explicit mailbox recovery coalescing with weaker startup enrollment. Several additional failures came from stale fixtures and literal prompt expectations rather than missing product behavior.

## Decision

Explicit mailbox recovery upgrades the shared enrollment request to require owner recovery. A controlled status barrier covers startup and explicit calls overlapping. Console-key migration may list existing inboxes but still cannot sign up or create another inbox. Permission failures retain structured `message_send` denial while incoming reception stays connected.

An explicit owner supplied during automatic owner lookup wins after that lookup settles. Reset and disposal invalidate deferred enrollment before provider IO; failed cleanup still settles the internal reset barrier while propagating the original error to its caller. The existing [owner recovery](2026-10-06-agentmail-recovery-owner-repair.md) and [signup fallback](2026-10-06-agentmail-ensure-403-fallback.md) decisions remain active; these lifecycle corrections preserve their provider and credential boundaries.

Abstract games requesting assets include the existing manifest and provenance requirement in their judge contract. The audio validator recognizes chained `.play()` separately from named sound helpers while retaining embedded-format checks. Curated connector approval, result and presentation use readable names without changing installer IDs. Proactivity tests assert the current bounded, authorized and non-duplicative policy without changing the prompt to satisfy obsolete wording.

## Alternatives considered

**Weaken acceptance requirements.** Removing provenance or audio checks would hide missing production evidence.

**Treat every failed fixture as a product defect.** Prohibiting an inbox list contradicts reusing an existing inbox; reading an expected ID before asynchronous assignment also cannot validate the result.

**Retry provider signup during startup.** Ambiguous provider enrollment still requires governed recovery and durable credentials.

## Consequences

The corrections preserve permission boundaries, provider identity and existing task semantics. Local tests prove the repaired contracts and deterministic interleaving; they do not prove live AgentMail delivery, browser audibility or complete game quality. Native voice and runtime loading repairs have separate evidence.

## Verification

Focused adapter suites cover the reported failures. The real Loader judge scenario snapshots the actual model request for an abstract game with requested assets, with only the external judge model replaced. Broad HARDNESS tests and package type checks must pass before publication; live services remain a separate verification level.
