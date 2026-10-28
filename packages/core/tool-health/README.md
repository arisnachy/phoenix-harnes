# @phoenix-ai/dsh-tool-health

English | [Español](../../../docs/phoenix-health-engine.md)

Optional native Kira Health Engine planning surface. A deterministic interview question planner, consultation state machine and fail-closed clinical-email preflight. No patient records, prescriptions, diagnoses, treatment or email are created, stored, signed or sent.

## Model Experience
Tools `health_interview_plan` and `health_kira_mail_requirements` return advisory, JSON-compatible outputs. Only general complaint text is permitted in the model-visible intake planning call; this package is **not** an electronic medical record. The prompt section appears only for health intent, reducing unrelated token consumption.

## Known Limitations and Deferred Work
No authenticated patient record backend, clinical UI, laboratory/pharmacy/radiology integration, validated medical triage engine, patient portal, Gmail/Calendar sender integration or actual email dispatch. An approved preflight means *eligible for a future queue*, not sent or signed. Clinical users must independently evaluate urgency, diagnosis and treatment. Do not use with identifiable patient information.
