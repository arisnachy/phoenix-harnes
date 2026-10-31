# PHOENIX Health Engine / Clinical Flow (pilot)

English | [中文](phoenix-health-engine.zh.md)

PHOENIX Health is an **optional** Host module. It does not replace Kira, Eclipse, or other engines. Its local clinical workspace is disabled by default and is **not approved for real-patient care**.

## Implemented state

- `PHOENIX_HEALTH_ENABLED=1` enables `/health` only when the Host binds to `127.0.0.1`.
- Longitudinal records use persistent SQLite with AES-256-GCM-encrypted clinical payloads, version guards, and HMAC-linked audit events. The entire SQLite file and metadata are **not** encrypted.
- The clinic requires local staff authentication, roles, CSRF, organization boundaries, and explicit patient care-team assignment.
- Encounters support interview answers, clinician-entered longitudinal history, SOAP drafts based solely on recorded answers, review and recorded signing; orders, results, prescriptions, stock, appointments, billing, and follow-ups remain governed by server permissions.
- Communication consent requires evidence and supports revocation. A checkbox alone is insufficient.
- Local backup uses consistent SQLite snapshots and integrity checks; it does not replace encrypted off-site backups and formal key recovery.
- Gmail sends only authorized neutral reminders after confirming the connected sender profile; it does not attach clinical records.

## Professional and ASK workflow

1. An authenticated clinician opens the clinic workspace and a patient assigned to their care team.
2. Kira uses `health_interview_plan` and `health_copilot_ask` for generic questions. The existing ASK provider selects Kira-led, professional-led, or mixed guidance.
3. ASK uses sensitive prompts and does not accept automatic, expired, or absent answers as facts. Identifiable clinical answers stay inside the protected record.
4. The professional reviews medical history, allergies, urgency, examination, and results. A subjective SOAP draft may use recorded interview answers, but it must not invent negative findings.
5. Orders, prescriptions, and clinical notes require server-side checks. Signing binds to the reviewed version. A manually flagged critical result requires explicit acknowledgment by the responsible clinician and direct clinical escalation; the module **does not notify clinicians automatically**.
6. Appointment reminders require verified permissions, auditable consent, and sender identity.

## Security and production limitations

- `health_copilot_ask` cannot read or send identifiable clinical record content to models. A consent- and role-aware clinical context broker remains to be designed and validated.
- Allergy, dosing, and interaction review requires clinician attestation; there is no automatically validated Dominican Republic drug catalog.
- Professional-license checks, legally valid e-signatures, real browser E2E tests, independent audit, and clinical/legal validation are still missing.
- FHIR/HL7, LIS, PACS/DICOMweb, health-insurer integration, a secure patient portal, external redundancy, and formal recovery remain unimplemented.
- Actual clinical use requires further privacy, security, testing, and regulatory authorization. **PR #1192 does not constitute production certification.**

## Run with synthetic test data

```powershell
$env:PHOENIX_HEALTH_ENABLED = "1"
pnpm phoenix
```

Read `packages/bundle/web-app/HEALTH-OPERATOR.md` for pilot controls. Do not use real patient information until validation is complete.
