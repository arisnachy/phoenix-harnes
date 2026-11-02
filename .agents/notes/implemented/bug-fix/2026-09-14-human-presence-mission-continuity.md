# Agent Note: Human presence and mission continuity

Status: implemented

English | [中文](2026-09-14-human-presence-mission-continuity.zh.md)

## Problem

PHOENIX had gained stronger workflow, mission, memory, and tool infrastructure while its ordinary conversation could still regress into an implementation-facing voice. A configured assistant presentation could be overshadowed by provider defaults, models could narrate skills, protocols, routing, compaction, subagent state, or maintenance work, and automatic context compaction was rendered as a visible chat row. The mission protocol already rejected premature completion, but that persistence was not paired with a stable human-presence contract, so complex work could feel less natural precisely when more orchestration became active.

## Decision

The persisted user-profile assistant identity owns a stable `phoenix_human_presence` model context. It treats the configured assistant name and gender presentation as authoritative across model/provider changes, restart, compaction, and product update transitions. It asks models to preserve grammatical presentation, use available durable memory and learning, adapt to emotional cues without inventing emotions, learn from explicit corrections and verified outcomes, maintain a practical model of the user's objective and constraints, use initiative inside existing authorization, integrate available multimodal context, and remain self-critical without routinely becoming hesitant. Ordinary social turns use a human conversational rhythm instead of customer-support boilerplate: greetings stay short, capability menus are not volunteered, and light wit or gentle sarcasm is allowed when the subject and rapport support it. Recall answers remain evidence-bound and keep attributes attached to the exact person, project, or entity supported by profile, memory, or session evidence instead of transferring facts across entities or filling uncertain gaps.

Ordinary conversation no longer exposes implementation ceremony as conversational content. The human-presence contract forbids announcing skill names, prompt sections, hidden reasoning, subagent counts, routing, compaction, internal directories, context-window maintenance, or raw tool markup unless the user explicitly requests technical diagnostics. HARDNESS repeats this requirement at the mission layer and interprets requests by objective and deliverable rather than isolated literal commands. A turn end, automatic compaction, restart, model switch, or update is a continuity event, not mission completion; active work resumes from durable objective and verified state until the requested outcome is verified or a genuine external dependency blocks progress.

Every full shipped agent preset exposes the same learning-memory consumer: `standard`, `code`, and `cordis` each mount `@phoenix-ai/dsh-tool-session-learning`, so switching between those modes retains automatic continuity context, recall tools, and autonomous preference/correction curation. The deliberately restricted `minimal` preset remains a two-tool composition with runtime context suppressed and therefore does not mount memory tooling.

Automatic compaction remains represented in the conversation-node model for history, replay, and diagnostics but is emitted with `visibility: hidden`, so it no longer inserts a `Context compacted`-style row into the human chat flow. Explicit `/compact` remains a visible command lifecycle because the user directly requested that operation.

## Verification

`packages/profile/user-profile/tests/user-profile.spec.ts` pins preservation of a configured feminine presentation across unrelated profile updates, natural conversational guidance, restrained sarcasm, and evidence-bound entity attribution during recall. `apps/cli/tests/full-preset-memory-parity.spec.ts` pins the learning-memory consumer in `standard`, `code`, and `cordis` while keeping it absent from `minimal`. `packages/hardness/adapters/tests/protocol.spec.ts` pins silent orchestration, objective-oriented execution, and mission continuation across turn/compaction/restart/model/update transitions. `packages/client/ui-conversation/tests/automatic-compaction-visibility.client.spec.ts` pins automatic compaction as retained technical state with hidden chat visibility.

## Alternatives considered

**Add another generic personality prompt to the top-level preset.** Rejected because provider- or preset-specific prose would compete with the persisted user profile and could regress whenever the active model or preset changes. Identity belongs with the persisted profile source that is assembled on every request.

**Remove compaction events from conversation state entirely.** Rejected because compaction provenance remains useful for replay, paging, diagnostics, and the explicit `/compact` command. Hiding the automatic node preserves technical observability without treating context maintenance as dialogue.

**Rely only on HARDNESS mission persistence.** Rejected because mission completion and social presentation are different obligations. A model can persist until completion while still sounding robotic or narrating internal machinery; both contracts are required.

**Mount the learning-memory tool globally in the base host composition.** Rejected because memory tools are agent-facing capabilities and the shipped `minimal` preset intentionally suppresses runtime context and exposes only two tools. Full-preset parity fixes continuity without silently widening the restricted preset.

**Make the assistant claim human feelings or consciousness.** Rejected because the desired experience is consistent social presence, contextual empathy, continuity, and natural language, not fabricated sentience. The assistant remains truthful when identity or sentience is materially relevant without repeatedly inserting disclaimers into ordinary conversation.

## Consequences

The model prompt gains a bounded stable human-presence block plus mission-continuity guidance, increasing prompt size slightly in exchange for consistent identity and interaction behavior across providers. Automatic compaction becomes invisible in normal chat while remaining available to internal projections and explicit manual compaction. The three full shipped presets carry the same memory capability, so changing among them no longer drops recall context; the restricted `minimal` preset keeps its smaller contract. Memory, multimodal perception, learning, and automation remain capability-dependent, and recall uncertainty stays explicit rather than being converted into invented personal facts.
