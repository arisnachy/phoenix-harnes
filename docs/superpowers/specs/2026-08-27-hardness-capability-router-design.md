# HARDNESS Declarative Capability Router Design

English | [中文](2026-08-27-hardness-capability-router-design.zh.md)

## Objective

Add a provider-neutral router that turns a declared `CapabilityNeed` into an honest route decision without executing tools, acquiring software, granting permissions, or replacing existing registries.

## Contract

`CapabilityRoute` contains the original need, selected capability when available, selected modality, required permissions, considered capability ids, and rejection reasons. Modalities are extensible strings; the initial supported values are `native`, `visual`, `workspace`, `sandbox`, and `generative-ui`.

`CapabilityRouter.route(need, options)` returns a discriminated result: `route` when a current verified capability and compatible modality exist, `missing` when the need is known but no usable capability/modality exists, and `unknown` when the need cannot be classified from the atlas. It preserves the resolver's evidence and permission explanations.

## Selection rules

The router delegates capability matching to `HardnessService.resolveNeed`. It rejects a capability whose declared modality set does not intersect the requested modalities. It sorts equally valid results by verified status, modality preference order, capability version descending, and id ascending. It never silently changes `missing` or `unknown` into `route`.

Required permissions are copied as declarations only. The router does not call a Permission Broker, sandbox, tool, visual renderer, workspace, or acquisition provider. Execution remains a later consumer responsibility.

## Lifecycle and integration

The router is a plain consumer service in `@deepseek-ai/dsh-hardness`, exposed through the existing HARDNESS service without changing the Tool Atlas source registries. It has no independent persistence; routes are derived from the current atlas snapshot and are therefore replayable.

## Verification

Tests cover verified native selection, requested modality mismatch, unknown kind, missing permission context, deterministic tie breaking, and preservation of `unknown`/`missing`. Package typecheck, oxlint, Loader composition, and the existing HARDNESS suite must remain green.

## Deferred scope

Visual execution, generative UI rendering, workspace mutation, sandbox grants, acquisition/build actions, and automatic capability promotion remain separate phases and are not implemented by this router.
