# Agent Note: Task-focused Healthia workspace

Status: implemented

English | [中文](2026-11-23-healthia-task-focused-workspace.zh.md)

## Problem

The embedded clinical application repeated role controls, authentication messages, institutional logo editing, and patient selectors inside routine consultations. Switching from the patient directory to consultation lost the selected patient and made the protected EHR appear like a generic administrative form.

## Decision

The PHOENIX app frame remains the owner of the conversation and composer. Healthia presents a compact contextual title, while role switching and diagnostic links live in optional disclosure controls rather than duplicate permanent strips. Authenticated clinical work begins with a searchable patient directory. The protected clinic view keeps the selected opaque patient identifier when navigating to consultations and offers an explicit action to continue with that patient.

Institution branding and logout live under the clinic options disclosure. Administrative controls do not compete with patient search, encounter selection, or draft-note editing. The clinical Host still owns authentication, records, version checks and EHR writes. The app never sends patient fields or notes to Kira, localStorage, or generic app blueprints.

## Alternatives considered

**Duplicate patient selectors in each module.** Rejected because it forces the user to reidentify the same person and increases wrong-patient risk.

**Move encounters into the chat model context.** Rejected because the protected EHR is the only authorized owner of clinical records, and role views are not an authorization mechanism.

**Replace the clinic service with mock dashboard records.** Rejected because fabricated clinical data or a simulated backend would misrepresent production readiness.

## Consequences

Routine actions have a visible search-first flow, fewer permanent controls, and continuity between patient and consultation screens. Technical and institutional settings remain accessible on demand. The patient and doctor views still require their own real Host permissions. The UX change does not claim that unimplemented agenda, billing, document issuing or cloud sync are operational.

## Testing

Focused React UI tests cover the collapsed technical options, authenticated clinical entry, protected record writes, and selected-patient navigation. Full compile, UI and Windows checks remain CI-owned.
