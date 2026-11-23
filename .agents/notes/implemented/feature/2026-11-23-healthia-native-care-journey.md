# Agent Note: Native Healthia clinical care journey

Status: implemented

English | [中文](2026-11-23-healthia-native-care-journey.zh.md)

## Problem

The embedded Healthia shell initially exposed only protected patient registration and encounter editing. Agenda, orders, prescriptions, billing, assignments and longitudinal follow-up had real encrypted Host resources but were not reachable from the native workspace. Clinicians also lacked explicit review and sign transitions, while a composed note could exceed the original single-column limit. Daily overview cards were illustrative instead of displaying authorized records.

## Decision

Healthia uses its existing authenticated loopback /health Host as the only owner of clinical records, CSRF, professional roles and optimistic versions. The native workspace now includes a real dashboard and role-filtered forms for appointments, follow-ups, laboratory/imaging orders, prescriptions, internal invoices, staff creation and patient assignment. The forms reuse the protected Host transitions; prescriptions and orders remain blocked until the responsible professional signs a reviewed encounter. Professional users can answer Host-generated Ask interview questions without exposing patient information to general chat.

The clinical editor splits authored note sections into history, examination, assessment and plan, persists them without silent clipping and reconstructs them for editing. It requires an explicit review and confirmation before signature. Demographic context, including the separately reported biological sex at birth and gender identity, is recorded with versioned protected updates. The overview displays real authorized patient records and scheduled appointments rather than fake metrics.

Native printing produces escaped, self-contained records for a deliberate user action, with a prominent unsigned watermark or an internal non-fiscal invoice disclaimer. The dose helper performs arithmetic only with clinician-supplied, independently checked mg/kg and per-administration maximum values; it does not offer drug-specific recommendations or claim interaction checking. Patient portal access remains separate and opt-in; authenticated patients can submit protected previsit histories as explicitly unverified contributions, which appear only in the assigned clinician's intake tab and require acknowledgment without becoming a verified diagnosis or replacing longitudinal history.

## Alternatives considered

**Store medical values in chat or browser localStorage.** Rejected because clinical identity, provenance, credentials and signatures belong to the Host's encrypted, audited record boundary.

**Treat an AI draft as a signed medical decision.** Rejected because suggestions, clinical questions and numerical dose calculations cannot replace an accountable clinician's review and authenticated signature.

**Rebuild a second clinic database for embedded apps.** Rejected because duplicate records and disconnected patient identifiers would compromise longitudinal continuity and team permissions.

## Consequences

A professional can select a patient once, perform an encounter, record interview answers, review and sign, then issue orders and prescriptions using existing protected endpoints. Administrative roles access only allowed scheduling, staff, assignments and internal billing workflows. Unsigned records are never labeled as issued prescriptions. The clinical UI no longer fabricates daily counts.

The existing patient portal remains subject to explicit service enablement and professional publication. Patient-written intake is encrypted, indexed by patient and organization, isolated by the portal's independent session/CSRF, and reviewed by an assigned clinician. Real automatic drug-interaction checks, a validated drug dosing formulary, fiscal e-CF issuance, comprehensive AI diagnostic accuracy and arbitrary cross-institution cloud synchronization are not asserted as implemented.

## Testing

Keyless tests cover role-scoped billing, protected invoice creation with CSRF, safe printing, explicit dose math, clinical note integrity, demographic update versions and long authored encounter fields. Full TypeScript compilation, web-client regressions, documentation pairing and Windows checks are required CI gates before publication.
