# Agent Note: APEX neuroscience teaching depth and diagram routing

Status: implemented

English | [中文](2026-11-06-apex-neuroscience-explanation-depth.zh.md)

## Problem

The user asked PHOENIX "puedes ayudarme a entender la fisiologia del estress que ocurre a nivel cerebal" and got a brief three-part overview with no meaningful visual. The research domain patterns missed commonplace brain, cerebral, stress-physiology and neuroendocrine wording, so the research planner could fall back to general sources. APEX expert quality checks were attached to expert research receipts, not consistently to naturally phrased scientific teaching questions.

## Decision

Extend the existing research router to classify mechanistic neurophysiology as neuroscience and prefer accessible academic biomedical sources (Europe PMC, NCBI Bookshelf) before additional datasets. Introduce a neuroscience-specific specialist contract with circuits, mediators, receptors, timescales and acute versus chronic comparisons. Strengthen the regular system prompt, HARDNESS bilingual cognitive guidance, research tool guidance and real raster-image tool description so a user asking how physiology works receives a causal explanation and, when warranted and feasible, one accurately labeled educational diagram.

## Alternatives considered

**Force research-expert and image generation for every medical keyword.** Rejected due to latency, noisy output, unnecessary expenses, and patient-record confusion.

**Ship a hard-coded stress essay or static diagram.** Rejected because APEX should generalize across neuroscience and other science questions while retaining honest provenance.

**Treat an SVG placeholder or empty card as an image.** Rejected: images must result from an actual generator; ordinary text explanations must stand alone.

## Consequences

A casual educational question can still have appropriate scientific depth without being mistaken for a patient-record request. Source routing and quality guidance are improved but depend on model choice and actual external provider accessibility; they do not guarantee image availability, citation completeness or clinical correctness at runtime.

## Verification

Added routing, neuroscience contract and system-prompt regression assertions keyed to the reported stress-physiology wording. CI must confirm compilation, tests and doc integrity; runtime model behavior and image backend availability require a deployed-session smoke test.
