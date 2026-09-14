# Agent Note: Universal Living Creations

Status: implemented

English | [中文](2026-09-13-universal-living-creations.zh.md)

## Problem

Phoenix could create files, interfaces, simulations, and runnable systems that became operationally disconnected from the harness after delivery. Domain-specific bridges do not scale because a future creation kind would require another harness change, while a prompt-only convention could be forgotten by a model and a visual Cordis surface proves only presentation, not control.

## Decision

Phoenix owns one domain-neutral `ctx.living` capability seam. A creation registers a self-describing manifest containing its identity, descriptive `kind`, target integration level, observable state names, actions, events, resources, and actors. `kind` is never interpreted as a closed taxonomy, so an unknown future creation type needs no core change.

Integration is ordered `static` → `connected` → `reactive` → `controllable` → `inhabited`. A creation chooses the strongest level that is genuinely meaningful. Static artifacts remain discoverable without inventing meaningless runtime concepts; interactive systems declare live state, events, actions, and optionally actors that Phoenix or its agents may operate.

`@phoenix-ai/dsh-living` is the Service Definition. `@phoenix-ai/dsh-living-local` persists manifests in an owner-private versioned JSON catalog and treats runtime provider attachment as ephemeral. Restart therefore restores known creations offline instead of forgetting them. A provider attachment proves the achieved level from actual methods and is rejected when it cannot satisfy the manifest target. Provider disposal changes connectivity but leaves durable identity intact.

`@phoenix-ai/dsh-tool-living` is the model-facing Consumer. Its standing system-prompt section applies the rule to everything Phoenix creates or materially modifies, independent of domain or format. The tools register and inspect creations, read live state, execute declared actions, and verify target-versus-achieved integration. `living_verify_creation` fails while a creation has not reached its declared target, preventing a connected system from being represented as complete solely because files or a preview exist.

Cordis visual workspace remains presentation-only. HARDNESS remains a capability inventory and modality router. Neither becomes execution authority for generated creations; adapters and generated runtimes attach through `ctx.living`.

## Alternatives considered

**Add bridges for known domains.** Rejected because every new category would require a harness release and unknown future creations would fall back to disconnected artifacts.

**Use only a standing model instruction.** Rejected because it provides no durable identity, no actual connection state, no action channel, and no machine-checkable completion gate.

**Reuse Cordis visual workspace or HARDNESS.** Rejected because their existing responsibilities are presentation and capability discovery. Giving either ownership of generated-runtime execution would mix independent lifecycles and authorities.

## Testing

The local-provider tests use an intentionally unfamiliar creation kind to prove there is no fixed taxonomy, then cover durable manifest persistence, provider-derived integration level, state reads, actions, events, disposal back to offline, and capability-level validation. Tool tests prove that the standing rule is universal rather than an enumeration and that completion verification fails until a declared live target is truly attached. The shared base bundle mounts the local provider and model Consumer so normal Phoenix profiles inherit the rule.

## Consequences

Every Phoenix creation now has one standard path to remain part of the harness instead of becoming a dead deliverable. Static and live creations share identity without being forced into identical behavior, interactive runtimes can reconnect after restart, and future adapters can add transports without changing the creation vocabulary. A creation running outside the Phoenix process still needs a transport adapter that implements `LivingCreationProvider`; the seam intentionally does not pretend an external runtime is connected until such an adapter is real.
