# ASK Clinical Longitudinal — 2026-10-20

## Intent
Keep Phoenix universal. Clinical conversations use the existing ASK service rather than adding a second medical UI. Questions marked `sensitive` never acquire invented clinical statements or consent at the 60-second deadline.

## Scope shipped
- ASK wire question `sensitive` attribute, common automatic-answer policy, consumer schema and tests.
- Opt-in model tool `clinical_longitudinal` with `create_patient`, `record`, `timeline`.
- Patient pseudonym IDs, explicit confirmation using ASK, AES-256-GCM authenticated encryption in a separate local vault, atomic file replacement with exclusive writer lock.
- Attributed observations (patient-reported, document-extracted, clinician-verified), lab deltas only for identical analyte and units.
- Failure when the key is absent, wrong or the patient ID invalid; no auto-consent and no automatic diagnosis.

## Security and limitations
`PHOENIX_CLINICAL_VAULT_KEY` must be a locally generated 32-byte hex key; optionally configure `PHOENIX_CLINICAL_VAULT_PATH`. The key must never enter chat, model arguments, the repository or version control. Model/tool conversations may still be recorded in ordinary Phoenix session logs; deploying with real protected health information requires a separate session-retention, RBAC, audit, key-rotation, deletion, backup, and threat-model review. No clinical production compliance is asserted.

No OCR, radiology interpretation, interoperable FHIR mapping, standardized lab unit conversion or diagnostic decision support is provided in this incremental change. Those are separate adapter layers with source provenance and clinical validation.

## Verification
Added keyless unit tests for safe ASK expiration, provider forwarding, encryption, patient separation, comparable trends, invalid dates and wrong keys. CI and an interactive browser run must validate integration before a clinical production rollout.
