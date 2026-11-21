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
