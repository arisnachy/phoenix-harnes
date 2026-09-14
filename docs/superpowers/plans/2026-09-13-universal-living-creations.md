# Universal Living Creations Implementation Plan

## Objective

Make a living connection a default property of everything Phoenix creates, using one self-describing capability seam rather than per-domain integrations.

## Tasks

1. Add failing tests for the `LivingRegistry` contract: arbitrary creation kinds, capability-level validation, offline manifest retention, provider attachment/disposal, state reads, action dispatch, and events.
2. Implement `@phoenix-ai/dsh-living` as the Service Definition with branded creation ids, manifests, provider interfaces, integration-level rules, and registry API.
3. Implement `@phoenix-ai/dsh-living-local` as the concrete provider. Persist versioned manifests atomically, restore them offline at startup, attach runtime providers effect-scoped, and publish committed changes/events.
4. Add failing tests for `@phoenix-ai/dsh-tool-living`: the universal model policy must not enumerate creation domains; register/list/inspect/read/act operations must use `ctx.living` and fail clearly when live capabilities are absent.
5. Implement `@phoenix-ai/dsh-tool-living`, including the standing system-prompt rule and model-facing controls.
6. Add a real Loader composition test that boots living + living-local + tool-living together and proves registration, provider-driven control, provider disposal, and offline rediscovery.
7. Mount the service definition/provider/consumer in `dsh-base`, add explicit package dependencies, project references, invariant companions, package READMEs, architecture/subsystem documentation, and an implemented Agent Note.
8. Run focused unit/composition tests plus package/config/document gates. Fix only failures introduced by this change; record unrelated repository-wide failures separately.
9. Open the implementation PR to `main`, inspect CI and the diff, merge only after the relevant checks pass, then backport the same verified behavior to the divergent `stable` branch and verify branch heads.

## Acceptance criteria

- Any creation kind can be registered without a harness code change.
- A manifest remains discoverable after its runtime provider disconnects or the harness restarts.
- The achieved integration level is derived from real provider capabilities, never only from metadata.
- Phoenix can read and act through a connected provider, and undeclared/offline operations fail loud.
- The base prompt instructs every model to register and verify every creation at the strongest meaningful level before delivery.
- Cordis visual presentation remains separate from execution authority.
- Relevant tests and configuration/document gates pass on the implementation branch before promotion.
- `main` and `stable` both contain the verified living-creation subsystem without discarding their independent commits.
