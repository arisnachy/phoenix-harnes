# Agent Note: Universal Living Creations

Status: implemented

English | [中文](2026-09-13-universal-living-creations.zh.md)

## Problem

Phoenix could create files, interfaces, simulations, and runnable systems that became operationally disconnected from the harness after delivery. Domain-specific bridges do not scale because a future creation kind would require another harness change, while a prompt-only convention could be forgotten by a model and a visual Cordis surface proves only presentation, not control.

## Decision

Phoenix owns one domain-neutral `ctx.living` capability seam. A creation registers a self-describing manifest containing its identity, descriptive `kind`, target integration level, observable state names, actions, events, resources, and actors. `kind` is never interpreted as a closed taxonomy, so an unknown future creation type needs no core change.

Integration is ordered `static` → `connected` → `reactive` → `controllable` → `inhabited`. A creation chooses the strongest level that is genuinely meaningful. Static artifacts remain discoverable without inventing meaningless runtime concepts; interactive systems declare live state, events, actions, and optionally actors that Phoenix or its agents may operate.

`@phoenix-ai/dsh-living` is the Service Definition. `@phoenix-ai/dsh-living-local` persists manifests in an owner-private versioned JSON catalog and treats runtime provider attachment as ephemeral. Restart therefore restores known creations offline instead of forgetting them. Durable manifest mutations are serialized through one commit queue and publish in memory only after the atomic write succeeds, so concurrent registrations cannot lose one another and a failed forget leaves the existing provider connected. A provider attachment proves the achieved level from actual methods and is rejected when it cannot satisfy the manifest target. Replacing a manifest while connected must remain compatible with the provider; events are checked against the latest committed manifest rather than the contract that happened to exist when the provider first attached. Provider disposal changes connectivity but leaves durable identity intact.

`@phoenix-ai/dsh-tool-living` is the model-facing Consumer. Its standing system-prompt section applies the rule whenever Phoenix creates or materially modifies a user-facing artifact or runnable system, independent of domain or format. The tools register and inspect creations, read live state, execute declared actions, verify target-versus-achieved integration, and explicitly forget durable identity. `living_verify_creation` fails while a creation has not reached its declared target, preventing a connected system from being represented as complete solely because files or a preview exist. Runtime loss never implies deletion; `living_forget_creation` is reserved for explicit user-directed forgetting or permanent deletion with no intended reconnection.

Cordis visual workspace remains presentation-only. HARDNESS remains a capability inventory and modality router. Neither becomes execution authority for generated creations; adapters and generated runtimes attach through `ctx.living`.

## Alternatives considered

**Add bridges for known domains.** Rejected because every new category would require a harness release and unknown future creations would fall back to disconnected artifacts.

**Use only a standing model instruction.** Rejected because it provides no durable identity, no actual connection state, no action channel, and no machine-checkable completion gate.

**Reuse Cordis visual workspace or HARDNESS.** Rejected because their existing responsibilities are presentation and capability discovery. Giving either ownership of generated-runtime execution would mix independent lifecycles and authorities.

## Testing

The local-provider tests use an intentionally unfamiliar creation kind to prove there is no fixed taxonomy, then cover durable manifest persistence, provider-derived integration level, state reads, actions, events, disposal back to offline, capability-level validation, concurrent durable mutations, manifest replacement against an attached provider, current-manifest event validation, and failed-forget rollback semantics. Tool tests prove that the standing rule is universal rather than an enumeration, that completion verification fails until a declared live target is truly attached, and that durable deletion occurs only through the explicit forget operation. The shared base bundle mounts the local provider and model Consumer so normal Phoenix profiles inherit the rule.

## Consequences

Every Phoenix creation now has one standard path to remain part of the harness instead of becoming a dead deliverable. Static and live creations share identity without being forced into identical behavior, interactive runtimes can reconnect after restart, and future adapters can add transports without changing the creation vocabulary. A creation running outside the Phoenix process still needs a transport adapter that implements `LivingCreationProvider`; the seam intentionally does not pretend an external runtime is connected until such an adapter is real.
