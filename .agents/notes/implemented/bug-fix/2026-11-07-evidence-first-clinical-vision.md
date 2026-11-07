# Agent Note: Evidence-first visual interpretation before clinical illustrations

Status: implemented

English | [中文](2026-11-07-evidence-first-clinical-vision.zh.md)

## Problem

PHOENIX could produce generic anatomy after the user uploaded a radiograph or a report and asked for an explanation of the findings. A text-only model route did not have image access unless borrowed vision was explicitly enabled. Even when an image was accessible, source description and document-reported diagnosis were not sufficiently prioritized before image generation.

## Decision

Enable the existing borrowed-vision route in the Web API gateway. The actual image remains in the durable attachment store, and a discovered vision-capable provider transcribes observed findings, visible document text, the report's written impression, and limitations before handing those observations to a text-only model. Preserve the fail-closed path if no image-capable route is available. Strengthen the unconditional clinical-vision prompt and image-generation guidance: interpret the submitted source first; distinguish the report's diagnosis from independent provisional interpretation; then create only source-supported illustrative artwork.

## Limits

A low-resolution screenshot cannot establish absent disease or substitute for an original radiograph or DICOM study. A single projection does not supply patient-specific 3D geometry. A conceptual three-dimensional explanation must be labelled illustrative; the existing research-only CT/MR reconstruction workflow is separate. This change does not claim validated autonomous diagnosis, universal PDF parsing, or a new specialist imaging model.

## Verification

An API proxy regression test checks the actual vision side-call, original image reference, context question, evidence-first transcription prompt and durable delivery. An image-generation unit test checks the source-evidence requirement. A real radiological sensitivity/specificity assessment, multi-page PDF validation and deployment-level model coverage remain outside these keyless tests.
