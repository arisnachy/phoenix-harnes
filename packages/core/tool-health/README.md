# `@phoenix-ai/dsh-tool-health`

PHOENIX Health Engine introduces a deterministic clinical workflow sandbox and optional inline PHOENIX desktop. All clinical content is **synthetic** and ephemeral: no actual patients, clinical decisions, prescriptions, email or persistent clinical records.

## Model Experience

### Clinical consultation assistance

#### What the model sees

`health_interview_plan` proposes up to four adaptive questions from a generic complaint and specialty, without identifiable patient data. `health_kira_mail_requirements` lists eight prerequisites for a future authenticated email adapter; none can be self-attested by the model. These are *planning* tools, not medical decision engines.

#### Token effect

The model prompt section is conditionally enabled only for health intent. The simulator does not invoke models, and does not inject hospital databases or patient data into prompt context.

#### KV Cache effect

Stable tool schemas and a short conditional health guidance section preserve otherwise reusable instructions. No changing patient data is serialized into the global system prompt.

## Clinical sandbox

The `ClinicSandbox` domain supports synthetic registration, appointments, signed encounter drafts, lab and imaging work orders, review of results, pharmacy stock, dispensing and invoices with role-based checks and institution scoping. The interactive PHOENIX visual workspace offers a sandboxed eight-area workbench via sidebar footer action. Data are not persisted when the visual workspace closes. The in-memory domain module and UI simulation are not yet wired into one clinical database.

## Known Limitations and Deferred Work

- Not a clinical production system or electronic medical record. Do not enter real patient information into the demonstration.
- No authenticated clinical staff identity, durable encrypted clinical storage, multi-tenant database, audit-proof logging, backups, legally compliant electronic signatures or patient portal.
- No verified healthcare provider prescription, validated clinical decision support, real pharmacy dispensing, DICOM/PACS, LIS, RIS, ARS claims, payment processing or medical device interfaces.
- The clinical UI and deterministic synthetic domain run separate demonstrations and do not persist the same data across sessions.
- The existing Workspace Gmail/Calendar capability is not equivalent to a verified Kira institutional sender. No clinical email is sent or reminder scheduled.
- Production deployment requires medical review, local privacy/legal approval, authenticated tenant isolation, code security audits, reliable provider integrations and end-to-end testing.
