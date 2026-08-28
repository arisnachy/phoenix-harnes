# HARDNESS One-Pass Assimilation Design

Date: 2026-08-28
Status: proposed for implementation
Base commit: `6afce388522b7849f943a2d5fa929c75bafb4f71`

## Goal

Make PHOENIX resolve capability gaps in one bounded execution loop instead of spreading discovery, diagnosis, repair, verification, promotion, and UI adaptation across separate passes.

A capability is not considered assimilated merely because it is indexed. It is assimilated only when PHOENIX can understand its contract, satisfy or report dependencies, execute it under policy, collect evidence, promote or quarantine it, and present its result through the correct interface surface.

## Non-goals

- Do not weaken HARDNESS verification or allow unverified capabilities to bypass policy.
- Do not add new donor catalogs while this work is in progress.
- Do not replace the existing HARDNESS registry, acquisition registry, approval system, artifact runtime, or OpenClaw compatibility runtime.
- Do not create a second control plane beside PHOENIX.

## One-pass lifecycle

For every mission capability need, run a single bounded lifecycle:

`resolve -> inspect -> qualify -> acquire -> prepare -> approve -> execute -> normalize -> render -> verify -> promote/quarantine -> learn`

The lifecycle may retry internally only for a concrete diagnosed cause. It must not restart discovery from zero after each failure.

### 1. Resolve

Ask HARDNESS for an already verified matching capability. If one exists, execute it directly.

### 2. Inspect

If no verified capability exists, collect all relevant indexed candidates and enrich their descriptors before choosing one. The enrichment must populate, where discoverable:

- input schema
- output schema / MIME family
- dependencies
- required permissions
- compatibility constraints
- limitations
- provider/runtime identity
- presentation hints
- provenance/version

### 3. Qualify

Run deterministic preflight checks before execution:

- duplicate/alias detection
- dependency availability
- permission requirements
- runtime compatibility
- renderer availability for rich outputs
- known quarantine/failure history

Candidates that cannot satisfy preflight are rejected with a concrete reason, not generic failure.

### 4. Acquire and prepare

Use the existing `AcquisitionRegistry`. Native builders and the OpenClaw broker must be registered explicitly. OpenClaw preparation must use the pinned package host and a concrete PHOENIX-owned package installer.

The production composition in `packages/hardness/adapters/src/index.ts` must wire the OpenClaw broker into `createHardnessAcquisition(...)` rather than merely indexing the catalog.

### 5. Approve

All effects remain fail-closed through the existing PHOENIX approval bridge. Capability acquisition, package installation, credential use, external side effects, and risky permissions must not bypass policy.

### 6. Execute

The production mission runtime must receive a concrete `CapabilityExecutor` capable of executing prepared non-tool capabilities. Existing tool execution remains the native fast path.

Execution failure must return a typed diagnosis containing at least:

- stage
- capability id
- provider
- failure class
- retryability
- missing dependency/permission when applicable
- evidence collected so far

### 7. Normalize and render

Every successful result passes through a central result normalizer.

The normalizer should prefer explicit capability output metadata, then infer conservative presentation types:

- tabular data -> table artifact
- numeric series -> chart artifact
- fields/schema -> form artifact
- image payload/reference -> image artifact
- document payload/reference -> document artifact
- safe HTML/app manifest -> sandboxed mini-app artifact
- unknown structured value -> JSON artifact
- plain scalar/text -> text artifact

The normalizer must attach `meta.artifact` so the existing conversation renderer can use the rich UI instead of falling back to raw text/JSON.

### 8. Verify and promote/quarantine

A successful execution alone is not enough. HARDNESS records evidence including contract match, execution result, output validation, renderer success, and policy compliance.

Promotion policy:

- `experimental -> testing` when static/preflight qualification passes
- `testing -> verified` only after valid execution evidence and output validation
- any deterministic unsafe/invalid behavior -> `quarantined`
- transient failures stay non-verified and retain retryable diagnostics

Verification must be version-bound so an updated capability is re-qualified.

### 9. Learn

Persist a compact usage recipe keyed by capability version:

- successful argument shape
- required setup/dependencies
- effective presentation surface
- observed failure signatures
- preferred use cases / routing hints

This knowledge belongs in PHOENIX/HARDNESS metadata and evidence stores, not in the model prompt. The model receives only the small subset relevant to the current mission.

## Production wiring changes

The first implementation slice must close the currently incomplete vertical path:

1. Add a concrete OpenClaw package installer owned by PHOENIX.
2. Instantiate the OpenClaw package host and broker in the HARDNESS adapter composition.
3. Pass the broker to `createHardnessAcquisition(hardness, builders, broker)`.
4. Provide a concrete `CapabilityExecutor` to `installHardnessMissionRuntime(...)`.
5. Add a descriptor enricher for tools, skills, and donor capabilities.
6. Add the result normalizer/artifactizer before mission completion.
7. Record promotion/quarantine evidence in the same mission transaction.

## One-pass orchestration rule

`runHardnessMission` owns one diagnostic context for the entire attempt. When a stage fails, the next action must consume that diagnosis directly.

Example:

- missing dependency -> acquire/install that dependency -> resume at preflight
- permission missing -> request approval -> resume at execution
- output not renderable -> normalize/adapt output -> validate renderer -> resume at verification
- candidate broken -> quarantine candidate -> try next already-ranked candidate

The orchestrator must not discard prior evidence and start a fresh generic mission unless the mission itself changes.

## Duplicate handling

Do not delete duplicates automatically. Compute a stable fingerprint from normalized contract, provider identity, implementation/package provenance, and semantic capability family.

Classify matches as:

- exact duplicate
- alias
- compatible variant
- overlapping capability
- superseded candidate

Routing chooses one canonical candidate while preserving aliases and provenance.

## UI contract

The interface must expose capability state rather than only final text. A later observability surface can read the same state, but this implementation only needs to ensure the runtime emits structured status/evidence events and rich artifacts.

Required user-visible states:

- preparing capability
- approval required
- executing
- repaired/retried internally
- verified
- quarantined/failed with concrete reason

External artifact actions remain disabled unless they traverse the approval bridge and executor.

## Failure boundaries

The one-pass system is bounded. It stops when:

- no candidate remains
- required approval is denied
- policy forbids the action
- a dependency cannot be safely acquired
- retry budget for the same diagnosed cause is exhausted
- the result cannot be validated

It must return the terminal diagnosed cause and preserve evidence for the next mission.

## Test strategy

Implementation is TDD-first.

Minimum required tests:

1. Verified native tool executes without acquisition.
2. Experimental tool is enriched, tested, evidenced, and promoted.
3. OpenClaw candidate is acquired through the production broker wiring and executed through the executor.
4. Missing dependency is acquired once and the same mission resumes without rediscovery.
5. Denied approval stops fail-closed.
6. Broken candidate is quarantined and the next ranked candidate is attempted.
7. Structured tool result becomes a rich artifact through `meta.artifact`.
8. Renderer failure prevents promotion.
9. Version change invalidates prior verification.
10. Duplicate candidates are grouped without destructive deletion.
11. No credential value is copied into ATLAS/evidence/model-visible metadata.
12. Existing native tool/skill behavior remains backward compatible.

## Acceptance criteria

The slice is complete only when an end-to-end test proves this path in one mission invocation:

`need -> no verified match -> candidate discovery -> descriptor enrichment -> preparation/acquisition -> approval if required -> execution -> artifact normalization -> evidence -> verified/quarantined state -> final UI-compatible result`

For OpenClaw specifically, at least five representative families must pass end-to-end: web/search, memory, channel/integration, device/computer-use, and provider.

No capability may be reported as "available" merely because it exists in the catalog. PHOENIX must distinguish `cataloged`, `prepared`, `executable`, `verified`, and `UI-capable` states.

## Implementation order

Keep this as one architectural feature, but land it in narrow testable commits:

1. orchestration tests and typed diagnosis
2. descriptor enrichment
3. OpenClaw installer/broker/executor production wiring
4. result normalizer + artifact bridge
5. evidence promotion/quarantine loop
6. duplicate fingerprinting and learned usage recipe
7. end-to-end matrix and regression gates

Do not add unrelated features until the acceptance criteria pass.