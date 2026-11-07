# Agent Note: Model-aware image reading without diagnostic anchoring

Status: implemented

English | [中文](2026-11-07-clinical-image-specialist-routing.zh.md)

## Problem

An uploaded 12-lead ECG was answered as likely WPW, despite neither a reliably documented delta wave nor calibrated PR/QRS measurements. The existing clinical prompt and generic concordance/visualization gates repeatedly highlighted WPW ahead of alternative findings. An unreviewed photographed ECG submitted as `deltaWave: present` caused a raw tool error. Phoenix Auto's first image-reading step still preferred its Luna coordinator, rather than an eligible visual analysis route.

## Decision

For a real image supplied in the current human turn, Phoenix Auto skips its initial planner-only message and attempts a source-reading first step with an account-advertised vision-capable Codex Terra model at Low effort. If no eligible Terra Low exists, it attempts a similarly verified Sol Low. Catalog listing and exact model-resolution metadata must demonstrate image input and Low effort; unavailable models are never synthesized. Explicit user model choices and nonimage turns remain unchanged. Subsequent orchestration retains the existing Eclipse behavior.

Remove disease-anchored WPW advice from the universal clinical prompt, diagnostic concordance and educational visualization gate. Keep a general ECG review of rhythm, axis, QRS, ST-T, territorial patterns, recording limitations and competing explanations, while reserving the specialized pre-excitation tool for genuinely supported suspicion. On uncalibrated photos, invalid numerical or confirmed-delta claims yield a structured non-diagnostic `SOURCE_EVIDENCE_MISMATCH` instead of an unhelpful raw tool failure. This does not weaken the calibrated-source requirement in the underlying checker.

## Alternatives and limits

Always forcing Terra was rejected because account or provider capabilities may be missing. Always using Luna with higher effort does not correct image-reading selection or diagnostic anchoring. The change does not install a new validated ECG interpreter, provide automated infarction confirmation or justify absolute confidence from photographs; acute coronary syndromes require clinical urgency assessment, additional leads, serial ECGs and biomarkers when appropriate. Model routing alone is not evidence of diagnostic accuracy.

## Verification

Add keyless tests for human-vs-tool image detection, Terra-to-Sol capability fallback, refusal to invent model capabilities, generic ECG concordance, non-preselected illustrations and safe photo tool rejection. CI's built and runtime checks remain authoritative; a representative expert-labeled ECG dataset is needed for clinical accuracy evaluation.
