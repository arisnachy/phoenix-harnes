# Agent Note: Sensitive ASK and encrypted clinical timeline

Status: implemented

English | [中文](2026-10-20-ask-clinical-longitudinal.zh.md)

## Problem

ASK currently infers an option after 60 seconds, which cannot represent a patient's testimony or informed consent. Clinical follow-up also needs a patient-isolated encrypted timeline without turning Phoenix into a medical-only system.

## Decision

Sensitive ASK questions expire unanswered. A clinical timeline tool registers only when a local vault key is configured. It can create pseudonyms, request ASK authorization before read/write, save attributed dated observations through AES-256-GCM, and compare numeric results with identical analyte and unit.

## Alternatives considered

A second medical-only questionnaire duplicates ASK. Defaulting to consent risks unauthorized recording. Plain-text JSON would expose health information. Always registering the clinical tool would add irrelevant cost to nonclinical sessions.

## Consequences

The feature is opt-in and fails closed. Session transcripts may still contain PHI outside the separate encrypted vault, requiring retention rules, RBAC, key rotation and patient deletion before any real deployment. No diagnostic certification, document OCR or FHIR export is claimed.

## Testing

Keyless tests cover ASK timeouts, question forwarding, vault encryption, patient isolation, date validation, compatible lab trends and incorrect key rejection. Production rollout still requires a privacy and clinical review.
