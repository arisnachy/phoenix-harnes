# Agent Note: Local anatomical research workbench

Status: implemented

English | [中文](2026-11-06-anatomy-workbench.zh.md)

## Problem

PHOENIX can explain medical images but could not create and inspect a study-derived volumetric surface without relying on unsupported model-generated anatomy. Making all anatomical systems appear confirmed from ECG, radiography, medical history, or generic segmentations would be inaccurate.

## Decision

Ship an explicitly experimental CT/MR pipeline in `scripts/phoenix-anatomy-reconstruct.py` that segments volumetric images using TotalSegmentator or imports clinician-supplied NIfTI masks, exports GLB meshes, and records provenance and uncertainty. Reuse a private model-weight cache, disable optional upstream usage telemetry, and avoid copying patient image paths into general prompts. Install optional imaging tools in a user-scoped environment during the existing Windows update without blocking PHOENIX startup. Serve only explicit research output files from a loopback Node HTTP viewer with an unguessable capability URL and local pinned Three.js modules. Kira receives a metadata-only anatomical workflow planner and environment readiness tool.

For authenticated HealthIA clinicians, the same pilot now accepts self-contained GLB files (up to 5 MiB) into the existing AES-256-GCM attachment store, restricted by patient care assignment. Its local module viewer is served only to clinical sessions, and an audited physician can attest comparison with original imaging plus limitations; neither that review nor a segmentation metric is clinical-device validation. Kira's ordinary prompt still cannot read patient records.

## Alternatives considered

Rendering a photorealistic generic patient heart as a proven digital twin would invent anatomy. Sending DICOM to a hosted viewer would introduce unnecessary third-party patient-data exposure. Shipping all research engines inside the main runtime would increase update size and startup failure risk. Automatic treatment recommendation from unreviewed segmentation is not acceptable clinical evidence.

## Consequences

The workbench can create investigational meshes when imaging quality, available weights and local resources permit. It does not provide verified diagnosis, clinical validation, signed patient-record entry, or an integrated OHIF/DICOM slice view. The planning catalog covers organ systems beyond TotalSegmentator's trained tasks, including peripheral nerves and small vessels, but those structures require task-specific validated models or expert segmentations. SimVascular and openCARP require separately verified platform integrations; they are not silently marked installed.

## Verification

Node tests cover activation, installation-state decisions, viewer authorization and refusal of misleading manifests; planner tests cover Spanish anatomy, ECG uncertainty and nonvolumetric imaging. Windows installation, full DICOM segmentation, model accuracy and operational access controls require CI plus validation on supported hosts and expert-reviewed studies before clinical deployment.
