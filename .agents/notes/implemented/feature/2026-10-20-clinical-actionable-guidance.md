# Agent Note: Actionable clinical guidance via existing ASK

Status: implemented

English | [中文](2026-10-20-clinical-actionable-guidance.zh.md)

## Problem

Phoenix already supports clinical history but may give generic advice to seek care rather than possible diagnoses, OTC measures, self-care and follow-up for common symptoms.

## Decision

The production Kira standard and Max presets load a dedicated clinical-guidance skill on health intent. It supplies reasoned differential diagnoses, tailored non-drug measures, conditional OTC options with contraindication screening, appropriate clinical follow-up and situation-specific red flags. Sensitive ASK and optional longitudinal storage are reused.

## Alternatives considered

Always-on medical instructions burden unrelated universal tasks. A hard-coded diagnosis calculator invents false certainty; referral-only replies do not meet clinical informational needs.

## Consequences

This improves communication and education but does not constitute an established diagnosis, medical prescription or clinical certification; patient context and source verification remain necessary.

## Testing

Add a focused preset contract test for both clinical skills and mandatory output safeguards. Validate clinical behavior in a live Phoenix conversation before deploying with real patient data.
