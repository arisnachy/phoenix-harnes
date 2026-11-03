# Agent Note: Kira main conversation ownership

Status: implemented

English | [中文](2026-10-01-kira-main-chat.zh.md)

## Problem

Actual subagent replies remain in child logs unless the parent conversation receives a durable public record. A live activity rail alone does not let the user follow the team, quote an intervention or react to it. Names inferred again from live task ordering change when agents finish, and retries across browser disconnections can duplicate work.

## Decision

Agent Teams owns model-hidden root records for actual append-only child text and immutable mission identity. The existing Session stream and conversation assembler deliver these records to the existing main chat. Receipt updates explicitly correlate as updates to one row. The browser receives canonical participant names, avatars and roles through the projection rather than importing host implementation values.

The main composer addresses existing continuable direct children and retains a request id across retries. Durable per-target receipts and acceptance markers in child inbox/history permit partial-delivery recovery. Kira receives a quiet, deduplicated supervisory notice; its acceptance is flushed before the supervisory checkpoint. Reactions use authenticated runtime identities, idempotent actor/emoji sets and the existing projection stream without model wakeups. Chat operations share the Team admission cutoff, cancellation signal and bounded disposal settlement.

Safe-boundary human intervention, conversational answers, and actual model badges follow the [user-priority and provenance decision](../bug-fix/2026-10-04-kira-user-priority-and-model-provenance.md).

## Alternatives considered

**Separate child conversations.** This exposes child history but breaks the requested common transcript and forces users to switch conversations to participate. The rail highlights the existing public interventions instead.

**UI-generated team dialogue.** Simulated replies cannot establish real agent authorship or reliable delivery. Only actual child text is published; private reasoning and tool blocks remain excluded.

**Cross-plugin persona imports.** Importing the host catalogue into a browser plugin violates the client bundle boundary. Canonical identity travels as wire data; portrait assets remain client-owned.

## Consequences

The host keeps a second model-hidden public representation of bounded text, increasing durable journal volume. Source message identity prevents backfill duplication. Transcript reads do not start cold agents. One-shot children remain visible but cannot receive a continuable reply. Full emoji selection is loaded on demand, and native glyphs avoid image CDN requests. The shipping deployment retains its two-specialist limit; sparse collaboration guidance and bounded model-facing reads constrain extra context, without claiming a measured total-cost reduction.

## Verification

Service tests exercise actual generic child output, malformed reactions, exact actor/root authority, next-step contextual intervention, multi-target partial delivery, idempotent retry, supervisory recovery and service disposal. JSONL and SQLite tests cover durable Unicode reaction replay/removal. The actual conversation assembler exercises receipt updates and full replay as one human row. Browser transport coverage lives in `apps/web/tests/kira-team-chat.e2e.ts`.
