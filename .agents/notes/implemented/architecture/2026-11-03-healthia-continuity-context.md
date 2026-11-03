# 2026-11-03 HealthIA — clinic-local longitudinal context and verification

PHOENIX remains universal; changes are confined to the optional local HealthIA clinical pilot.

## Decision

Introduce a clinician-authorized **read projection** (not a new patient store) for
`/health`, consolidating encounters, orders, prescriptions, follow-ups, appointments,
observations and patient documents from the same encrypted SQLite repository.
No PHI is routed into the universal chat or the unrelated `ctx.healthia` store.

New numeric observations are physician-entered and initially **unverified**.
The original patient- or document-sourced evidence is not silently converted into
a diagnosis; physician confirmation is an authenticated auditable transition.
Reading a PDF/image also records a separate reviewed-by / reviewed-at event.
Concurrent edits use record version checks and retain the original encrypted bytes.

## Safety tradeoffs

An observation comparison uses identical display name and exact unit; this is a
display-only trend, **not** unit conversion or automated threshold interpretation.
Reference intervals remain optional and source-specific. Reports may have misleading
units, so the physician verifies them explicitly. Psychotherapy encounter access must
remain restricted to author permissions.

The longitudinal projection uses existing bounded local record queries. It is
not a complete data migration, hospital-grade FHIR server, validated LIS, automated
medical-device ingestion, or approved clinical production system.

## Verification required

Focus on auth separation, source attachment/patient match, unsigned numeric data,
professional verification, optimistic locking, encrypted persistence, clinical
workflow and inline UI script parsing, then TypeScript build and relevant CI.
