# Universal Living Creations

## Goal

Every creation produced by Phoenix remains connected to the harness at the highest integration level that is meaningful for that creation. Games, applications, documents, simulations, dashboards, generated services, virtual environments, and future creation types all use the same self-describing contract rather than type-specific integrations.

## Design

Phoenix gains a `ctx.living` capability seam. `@phoenix-ai/dsh-living` declares the contract, `@phoenix-ai/dsh-living-local` owns the process-local registry and durable manifest catalog, and `@phoenix-ai/dsh-tool-living` exposes the capability to models. A creation registers one manifest that declares identity, kind, target integration level, observable state keys, actions, events, resources, and actors. The registry never infers domain semantics from `kind`; unfamiliar creation types work without harness changes.

A manifest can exist while its runtime provider is offline. The registry persists manifests so Phoenix can rediscover creations after restart, reports the current connection state separately, and accepts a provider attachment for the same creation id when its runtime returns. Provider registration is effect-scoped and disposal makes the creation offline without deleting its durable identity.

The integration levels are ordered: `static`, `connected`, `reactive`, `controllable`, and `inhabited`. `static` means Phoenix retains identity and a modification path; `connected` adds live state; `reactive` adds events; `controllable` adds actions; `inhabited` adds actors Phoenix or subagents may operate. A creation declares a target level, while the registry derives the currently achieved level from the attached provider. Static artifacts are not forced to invent meaningless actors; interactive systems are expected to reach the strongest useful level.

## Model policy

`@phoenix-ai/dsh-tool-living` registers a standing system-prompt section. Whenever Phoenix creates or materially modifies a user-facing artifact or runnable system, the model must register it with `living_register_creation` before treating delivery as complete. The model chooses the strongest meaningful target level, instruments interactive creations so a provider can attach, and verifies the achieved level with `living_inspect_creation`. The rule is universal and intentionally avoids enumerating creation types.

The model-facing consumer also exposes list, inspect, read-state, and act operations. `living_act` fails loudly when a creation is offline, the action is undeclared, or the provider does not implement control. `living_read_state` fails when live state is unavailable. This keeps presentation separate from authority: Cordis visual workspace may display a creation, while `ctx.living` owns its operational connection.

## Runtime contract

A provider supplies `readState`, `act`, and `subscribe` methods as required by the manifest's target level. The registry validates that the provider can actually achieve the level it claims before publishing it as connected. Events are delivered only after provider attachment and are names checked against the manifest. Consumers subscribe to registry change and creation-event notifications and re-read authoritative state instead of reconstructing it from deltas.

The local provider stores manifests in a versioned JSON document under Harness home. Writes are atomic and serialize before the in-memory catalog changes. Startup restores manifests as offline records. Runtime providers then reattach by creation id without replacing the manifest unless an explicit registration update occurs.

## Completion and failure behavior

Registration rejects blank ids, duplicate action/event/state/actor names, an invalid level, or a manifest whose target level contradicts its declared capabilities. Provider attachment rejects unknown creations and providers missing methods required by the target level. Unregistration of a provider is not deletion: the creation remains known and offline. Deleting a creation requires an explicit model-facing operation so temporary runtime loss cannot erase Phoenix's relationship to its work.

## Testing

Unit tests cover manifest validation, unknown creation kinds, provider capability checks, action dispatch, state reads, event filtering, provider disposal, offline restoration, and durable manifest round-trip. Tool tests prove the universal prompt rule and model-facing operations. A real Loader composition test boots the service provider and tool consumer together and verifies that a creation can be registered, inspected, controlled through an attached provider, then rediscovered offline after provider disposal.

## Integration

The three packages are mounted in the shared base bundle so the rule applies to every normal Phoenix profile. The architecture map documents `ctx.living` as the operational owner for creations; Cordis visual workspace remains presentation-only. `main` receives the implementation first. Because `stable` has independent commits, the verified implementation commit is then applied to `stable` without replacing unrelated branch history.
