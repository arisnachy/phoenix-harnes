# Agent Note: Universal capability-use policy

Status: implemented

English | [中文](2026-09-18-universal-capability-use-policy.zh.md)

## Problem

PHOENIX already exposes a broad capability surface: durable memory, session retrieval, files, web access, Code Mode, visual rendering, connectors, scheduling, background jobs, subagents, and the HARDNESS capability index. The remaining failure mode was orchestration quality rather than raw availability. Different providers could choose a generic route when a more authoritative source existed, answer freshness-sensitive questions from model memory, infer file contents from partial previews, miss relevant prior context, create a textual substitute for a requested visual, or discover connectors before first checking native capabilities. Those mistakes make an equipped harness behave as if it lacks capabilities and can add latency, token use, and unnecessary authorization work.

## Decision

Full model-facing HARDNESS scopes install one stable `hardness:capability-operating-protocol` section. The policy gives every provider the same compact decision ladder before tool use: identify the authoritative source, recover materially relevant context, prefer the most specific healthy native capability, use live public evidence when freshness matters, use connected private sources only when account state is required, retrieve actual file content before making file-dependent claims, and use visual or generative capabilities when the requested deliverable is visual rather than substituting prose.

The policy keeps execution capability-dependent. It does not grant permissions, invent unavailable tools, or bypass approval. Missing private capabilities flow into the existing connector protocol; missing general capabilities flow through HARDNESS resolution/acquisition. Future and recurring work uses the durable task system instead of an idle agent. Condition monitoring prefers event-driven connectors when available and otherwise uses bounded scheduled checks. Tool failure is classified before recovery so authorization failures, transient transport failures, unavailable capabilities, invalid input, and stale evidence do not collapse into the same blind retry behavior.

The protocol also sets a latency and cost floor: no redundant inventory calls when a healthy capability is already known, independent read-only work may be batched when safe, and subagents are reserved for genuinely independent work, verification, or review within the shared budget. User-facing output presents the result and evidence rather than internal routing machinery or private reasoning.

## Verification

`packages/hardness/adapters/tests/capability-protocol.spec.ts` pins registration order and the source-authority, freshness, file-retrieval, visual-deliverable, automation, bounded-recovery, and low-overhead rules. `packages/hardness/adapters/src/index.ts` installs the section for model-facing scopes beside the existing HARDNESS, proactivity, human-presence, and connector protocols.

## Alternatives considered

**Rely on each model provider to infer the right tool strategy.** Rejected because provider swaps then change product behavior even though PHOENIX owns the same tools and state.

**Add every tool schema and special case to one giant prompt.** Rejected because that increases prompt cost, harms cache stability, and duplicates registries that already describe executable capabilities.

**Hard-code a deterministic router for every user request.** Rejected because intent classification and tool choice remain partly semantic, while HARDNESS already owns deterministic workflow and capability verification. The new policy guides the model without creating a second execution authority.

**Fold these rules into the connector protocol.** Rejected because connector selection is only one branch of the decision. Local files, session memory, public web evidence, visual rendering, native tools, and scheduled work must follow the same source-first policy even when no connector exists.

## Consequences

Model-facing scopes gain a small stable prompt block in exchange for more consistent use of capabilities across providers. The change should reduce unnecessary connector discovery, stale answers, guessed file content, redundant tool calls, and textual fallbacks for visual requests. Actual execution still depends on mounted capabilities and existing approval, privacy, safety, and verification boundaries; the policy cannot make an unavailable provider real.
