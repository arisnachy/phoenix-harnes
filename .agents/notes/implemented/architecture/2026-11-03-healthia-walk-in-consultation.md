# HealthIA walk-in consultation with locally encrypted patient documents

2026-11-03 | PHOENIX Health pilot | PHOENIX remains a universal harness.

## Scope
The existing authenticated local clinic gains a clinician-first `Mi consulta` page.
It combines patient selection, quick patient creation, visit creation, prior signed plans,
pending follow-ups and a chronological view of encounters, orders, prescriptions and
patient-provided attachments. It does not expose patient records to the general Kira chat.

## Document boundary
PDF, PNG, JPEG, WebP only; 5 MiB maximum, 100 per patient. A bounded authenticated
JSON upload performs strict base64 checks and file-signature inspection. Files are
AES-256-GCM encrypted with identity-scoped AAD inside the same SQLite database.
Downloads require clinician/psychologist patient and encounter authorization.
The existing consistent SQLite backup includes the attachment table.
No mail, external AI or patient portal transmission occurs.

## Constraints
- Uploaded documents are patient-provided and pending clinical review, never treated
  as verified findings or diagnoses.
- No autonomous prescription, diagnostic or emergency handling.
- The module is a local pilot, not validated for real patient care.
- Large files, antivirus scanning, formal encrypted off-site backups, patient identity
  linking, physician-side review attestations and patient portal integration are future work.

## Verification plan
Run the Node health-store and health-ui suites, then host/client TypeScript build and
the repo's relevant UI and security gates. Exercise wrong role, unassigned patient,
malformed MIME and persistence restart, then review the full clinical flow in-browser.
