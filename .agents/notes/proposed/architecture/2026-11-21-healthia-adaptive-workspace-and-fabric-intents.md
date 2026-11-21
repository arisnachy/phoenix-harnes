# Healthia adaptive workspace and PHOENIX Fabric intent boundary

## Decision

Keep PHOENIX General as the immutable default presentation. A role-aware Healthia workspace is a reversible browser view over the same conversation surface, not a replacement agent, a new provider, or a second patient store. The application launcher changes the context menu, top workspace region and role-specific navigation. It never grants clinical authority.

## Why

A medical assistant needs patient and clinician experiences without forking PHOENIX's universal harness. Patient identity, record storage and consent cannot be inferred from a model answer or browser UI state. The existing authenticated `/health` pilot remains the only entrypoint from the initial medical workspace for real clinical operations.

## Shipped first slice

- General/Healthia application selector; médico/paciente role views and contextual sidebar; return to General without changing provider or chat session.
- Schema-label editor with local in-memory drafts only, explicitly not a clinical form publisher or patient record.
- An authenticated clinical service link for medical workflows. No patient-login claim for the preliminary patient view.
- Metadata-only request/receipt contract with fixed purpose, scope and output types, bounded expiry and no transfer capability.

## Declarative application contract

A bounded capability catalog now declares a stable application ID, roles, advertised surfaces, connection/readiness state and user-visible explanation. Its static entries are not equivalent to introspection of an installed provider or permission grant. The form metadata editor accepts fixed field and output types with bounded labels and revisions. It rejects arbitrary properties, network destinations and executable JS, leaves non-local API/Chat/AI bindings disconnected, forbids deletion of protected fields, and can revert an invalid proposed update to the last safe draft. These are reversible UI draft operations only; clinical form publishing requires a protected backend and explicit approval.

App Studio starts as a chat mission from the application's menu, creates a regular session and submits a fixed prompt through the existing input pipeline. Kira first plans with the user, identifies actually available tools and routes, then proposes screenshots or truthful visual previews with an approval gate before editing an isolated extension. The generic blueprint renderer is a validated preview building block, not an end-user app wizard or an installer.

Fast preloading should load *manifests* and validated shell components without eagerly loading every connector or model into the context window. A future runtime registry needs bounded snapshots of active, health-checked adapters with provenance, readiness, cost, role scope and permission requirements. The AI receives only a minimal, permission-filtered capability summary; it cannot inspect secrets, operating-system internals or patient records by claiming to know its own body.

## Adaptive OS self-model and guarded changes

The browser owns a live read-only snapshot of a fixed list of registered UI slots, distinguished from the static app capability declarations. The `adaptive:inspect` command reads local package manifests and returns only package IDs, declared dependency names, source-relative metadata and quality-gate *names*, never their command bodies, credentials, logs, clinical records or secret paths. Source presence is not proof that a provider is loaded, authenticated, healthy or safe to use. Kira must verify live state through supported tools before promising a capability.

App Studio's creation entry is a real conversation mission: the UI emits only `{intent:'new-app'}`, and the conversation plugin creates a normal session and submits the planning request through the existing input admission/Host pipeline. That request plans user goals, feature discovery and faithful Pearl Light previews. It cannot itself install code, acquire medical-record permission or authorize a network request. Any execution uses existing agent/tool authorization and user approvals.

The `reviewAdaptiveChangePlan` function classifies candidate paths as isolated extension, elevated harness review or blocked secret/clinical content. It returns `authorized:false` and `mayApply:false` for every plan. The policy is *preflight only*, not an approval verifier or rollback runner. Real self-modification requires a dedicated privileged supervisor with verified immutable starting commit, isolated worktree, clinical boundary checks, synthetics, required CI, explicit promotion, durable checkpoint and tested rollback. A broken adaptive UI remains isolated behind a React error boundary; returning to General leaves the conversation mounted.

## Operational second slice (unmerged until CI passes)

- `adaptive_app` proposals are validated inside the existing generative UI renderer. A human button starts local-only manifest installation; browser storage preserves bounded application names and sections plus a last-good snapshot. No executable code, URLs or credentials are stored.
- `adaptive_form` proposals declare fields, types, destinations and output styles. The user approves an atomic, versioned schema-only change to a previously installed generic app section. Unknown keys, medical-app IDs, uninstalled targets and over-limit fields are rejected.
- Local generic form values are view-only and discarded on unmount. Do not use this preliminary store for patient data, billing, account secrets or regulated records. Healthia clinical forms and patient records remain under `/health` authentication.
- App Studio's chat mission runs in a normal Host session with Kira and existing selected model, using actual tools rather than a second assistant.
- The core harness is never self-modified by these client events. `reviewAdaptiveChangePlan` is fail-closed and cannot authorize or apply code changes. A future supervisor must enforce authenticated approval, isolated staging, test gates and rollback.

### Verification commands

`node --test scripts/phoenix-healthia-exchange-contract.test.mjs scripts/phoenix-adaptive-self-model.test.mjs scripts/phoenix-adaptive-change-policy.test.mjs`

`pnpm exec vitest run packages/client/ui-layout/tests/adaptive-form-store.client.spec.ts packages/client/ui-layout/tests/adaptive-app-registry.client.spec.ts packages/client/ui-layout/tests/app-frame.client.spec.tsx packages/client/ui-conversation/tests/adaptive-app-proposal.client.spec.tsx packages/client/ui-conversation/tests/adaptive-form-proposal.client.spec.tsx packages/client/ui-conversation/tests/adaptive-app-mission.client.spec.ts`

Client typecheck, package purity gate, Windows build and secret scanning are required before any merge.

## Next operational integration

The next phase must connect the live self-model to a host-controlled capability registry that reports health, version, permission scope and actual runtime availability; add an approved manifest-driven persistent app registry, a signed action dispatcher, and an isolated change transaction. Clinical Healthia form publishing must use its protected backend and never mirror patient values into the ordinary chat. Images generated during visual planning are proposals, not verified implementation.

## Fabric trust boundary

The proposal contract is not an authorization check, signature verifier, patient lookup or transport. `subjectToken` is an opaque backend-issued capability reference, never a cédula, telephone or chat session ID. Browser events carry only workspace role and section; no patient material should appear in them. All cross-instance exchange remains **disabled** until the clinical service implements recipient authentication, patient/authorized-representative consent, professional relationship and legal basis, minimum-necessary filters, protected output generation, delivery encryption, signatures, idempotency, audit receipts, revocation and clinical data residency.

## Outputs and lifecycle

Allow intent for three *references*, not payloads: FHIR R4 reference, protected clinical-summary PDF reference and protected-document reference. Every delivery must use a server-authorized, short-lived exchange operation: request → recipient review → patient/representative consent when applicable → professional approval → encrypted transfer → delivery acknowledgement → audit / revocation. An approval in one installation never automatically authorizes another. No unsolicited LAN discovery or implicit pairing.

## Alternatives rejected

- Running executable model-generated code inside clinical forms: unsafe authority boundary.
- Using model memory or general-session storage for clinical PHI: cross-domain data leakage.
- Syncing complete records by matching names, telephone numbers or cédulas: identity and privacy failure.
- Treating the patient preview as a login portal: false assurance.
- Auto-merging divergent main/stable branches: risk of unrelated regression.

## Verification

Focused validation should compile the client UI and execute the metadata exchange contract tests, plus UI tests for return-to-General, role switch, sidebar state, keyboard navigation and non-disclosure. End-to-end clinical data tests require an authenticated `/health` environment. No real patient data is needed for synthetic acceptance tests.

## Deferred work

1. Protected first-party in-chat medical form, connected to the canonical clinical backend without model exposure.
2. Persisted, versioned schema proposals with clinician approval and rollback.
3. Authenticated patient portal with delegated representatives and explicit consent state.
4. Cryptographically verified PHOENIX-to-PHOENIX pairing, signed requests and FHIR/document exchange with revocation.
5. Real integration tests on independent instances and legal/clinical governance review.
