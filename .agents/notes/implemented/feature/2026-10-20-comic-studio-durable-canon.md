# Agent Note: Durable canon and raster production for Comic Studio

Status: implemented

English | [中文](2026-10-20-comic-studio-durable-canon.zh.md)

## Problem

Generating each comic panel independently changes recurring characters, loses visual references and can contradict the prior issue. A text prompt or collection of image files cannot describe or reliably replay character identity, narrative state, reading order or release provenance.

## Decision

`scripts/phoenix-comic-studio.mjs` owns a persistent per-series project in `~/.dsh/comic-studio/series/`. Characters have stable IDs, written visual signatures, baseline states and immutable reference-asset IDs. Issues and numbered pages hold ordered panels, editorial text, art IDs and explicit before/after transitions. Art is imported by SHA-256 into the series storage and cannot be replaced under the same logical ID. An audit checks missing or changed image files, references, duplicate panel IDs and narrative state transitions across issues before non-draft rendering. HTML preserves image and lettering as separate layers; optional Chrome-backed PDF and rasterized CBZ are real files when the rendering process succeeds. Kira can request the image-generation brief and orchestrate a provider via its normal skill capabilities.

The local CLI is the source of truth and survives conversations and ephemeral task runtimes. The production skill is a consumer of this CLI, rather than a specialized redesign of Phoenix's universal agent loop.

The model-facing `phoenix_comic` tool publishes a verified, non-draft Comic Studio release as an inert `application/vnd.phoenix.comic+html` artifact in the existing conversation surface. It reads the durable release manifest and checks exact HTML SHA-256, actual embedded raster panels and local-only markup. The client scales the same edition responsively in a sandboxed, script-disabled preview. Completion language requires an actual artifact receipt, never a nested MiniBrowser displaying Phoenix itself.

## Alternatives considered

**One prompt and one raster image per page.** Rejected: recurring identities and balloons become coupled to a non-editable image, and individual panels cannot be repaired without destroying approved art.

**Persist the plot only in chat history.** Rejected: contexts compact, agents and providers change, and there is no stable revision or verifiable visual asset identity.

**Consider matching SHA-256 hashes proof of character likeness.** Rejected: byte integrity is not visual similarity, artistic quality, or image-generation reference compliance.

## Consequences

The engine provides durable, testable canonical records and independent export assets at the cost of authoring JSON scene specifications and needing an actual image generator for illustration. It does not supply a native image model, visual embeddings, perceptual identity verification, cover or print-bleed production, publisher authorization, or automatic rights clearance. Audit receipts explicitly keep `visualConsistencyVerified`, `narrativeQualityVerified`, `rightsVerified` and `printProofVerified` false; human visual and editorial review remains required. Browser-backed exports cannot be claimed until they have run successfully in the target runtime. The dedicated chat publisher validates file and raster structure but cannot create art, assess character likeness or prove that an iframe visually rendered; those checks require independent observation.