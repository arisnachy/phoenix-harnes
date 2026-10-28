# `@phoenix-ai/dsh-tool-health`

Optional PHOENIX Health Engine planning tools, supporting a clinical pilot that stays within the existing PHOENIX Host. Health is not a standalone application and does not replace Kira.

## Architecture

The model-facing `tool-health` package deliberately **never** exposes patient records or credentials. Its `health_interview_plan` produces general adaptive interview prompts and `health_kira_mail_requirements` explains fail-closed sender checks.

The separate opt-in web clinic runs at `/health` inside `packages/bundle/web-app` and has an encrypted, durable SQLite record store and local staff authentication. Clinical access is checked by role, organization and explicit care-team assignment, with audited grants and revocation. Patient contact consent is recorded with verification evidence and an auditable revocation. Records have revision guards, practitioner review and signing steps, study orders, inventory transactions and internal invoices. SQLite online backups can be created and integrity-checked by clinic administrators.

The independent `ClinicSandbox` domain remains in the package for deterministic synthetic workflow tests. It does **not** represent the production store.

## Model Experience

### Clinical interview planning

#### What the model sees

The model sees only a generic complaint, specialty, mode and **question keys** supplied to `health_interview_plan`. No patient names, identifiers, clinical narratives, imaging, diagnoses or medical records are automatically transmitted to the model. It also sees the list of required email checks through `health_kira_mail_requirements`, not the results of authorization checks or actual emails. The clinician opens protected records separately within the Health workspace.

#### Token effect

The system-prompt guidance is only attached when medical intent is detected. Database reads and deterministic clinic workflows do not require an LLM invocation.

#### KV Cache effect

Stable tool schemas and bounded conditional guidance avoid injecting session-specific patient data into global model instructions, preserving the reusable system prompt.

## Known Limitations and Deferred Work

- **Not certified or approved for clinical production.** Operator documentation: `packages/bundle/web-app/HEALTH-OPERATOR.md`.
- Clinic storage encrypts clinical record payloads, **not the entire SQLite file or staff/organization metadata**. Host filesystem permissions, verified backups and security review remain essential.
- Only locally bound operation is exposed. External hospital integration, FHIR interoperability, DICOM/PACS, LIS/RIS, medical-device connections, patient portal, verified identity credentials and legal digital signature are not implemented.
- Kira cannot autonomously read protected patient records; a secure consent- and role-aware human-controlled context broker remains to be built and validated.
- Phone/email confirmation is attested by authenticated staff and associated with an evidence reference, **not independently validated** by a verification service.
- Gmail sending is limited to manually authorized, nonclinical appointment reminders from an account whose real provider profile matches Kira's configured sender. No patient documents or medical details are sent.
- A local SQLite backup and restoration test are present; off-device recovery, retention, key recovery, external audit, threat assessment and end-to-end clinical validation are still missing.
