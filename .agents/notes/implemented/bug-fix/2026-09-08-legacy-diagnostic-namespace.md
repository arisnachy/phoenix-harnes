# Agent Note: Legacy diagnostic namespace references

Status: implemented

English | [中文](2026-09-08-legacy-diagnostic-namespace.zh.md)

## Problem

The namespace gate rejects the legacy client module string used by `doctor` to detect an obsolete installation, together with its rejection fixture. Neither string imports or registers a legacy package.

## Decision

Permit only the exact diagnostic and fixture lines at their owning paths. Other references in those files remain subject to the namespace gate. Keep the detector and its rejection behavior unchanged.

## Verification

Focused scanner regressions must accept those two lines and reject legacy imports, changed references and different contexts. The repository scan remains the acceptance check for active references.

## Alternatives considered

- Exclude the diagnostic files: permits unrelated legacy imports.
- Hide the legacy name through string concatenation in production: weakens the auditability of the detector.
- Remove legacy detection: lets obsolete client bootstraps pass diagnostics.

## Consequences

Changing either approved diagnostic line requires an explicit exception review. This exception grants no runtime capability and does not permit legacy package dependencies.
