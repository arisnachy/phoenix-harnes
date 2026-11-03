# Agent Note: Comic creative canon and provider isolation

Status: implemented

English | [中文](2026-10-21-comic-creative-canon-provider-isolation.zh.md)

## Problem

Persistent raster assets and generation-attempt receipts preserve bytes but do not preserve an approved artistic goal. A user may provide both an existing illustration and separate examples of a desired cover, interior layout, and back cover. Treating these as one image series, or delegating a vague comic brief to an external design provider, silently replaces the intended plot, recurring characters, framing, and visual language during interruptions.

## Decision

`scripts/phoenix-comic-canon.mjs` owns a project- and issue-scoped creative contract in the existing persistent Comic Studio series directory. It records the synopsis, ordered page beats, character signatures, rendering, palette, exclusions, editorial layout, covers, and SHA-256-verified local references. Each reference has a distinct role: generated artwork, style or character anchor, mood reference, or cover, back-cover and page-layout target. The contract is proposed once; locking requires an explicit user-attributed approval and matching digest. It cannot be silently overwritten by a later turn or provider.

`packet` derives model instructions from the locked contract for one target image. Its Canva variant permits layout only, requires existing generated artwork and prohibits regeneration. The existing recovery journal records the canon digest for each new attempt, preserves responses with mismatched digests, and refuses to accept mismatched art as final. Older imported art remains recoverable, but does not count as visually approved for a new locked canon without a fresh review receipt.

The local contract is separate from chat history and survives model/provider changes and turn interruptions. A chat log or design-provider ID is not a substitute for the contract or for the original raster bytes.

## Alternatives considered

**Keep continuity exclusively in messages or Canva designs.** Rejected because context may compact and provider responses can time out, change schema, or return an unusable ID.

**Consider every available image an approved style anchor.** Rejected because concept explorations and editorial targets can depict completely different projects.

**Regenerate everything after a failed tool response.** Rejected because a malformed result is not evidence that previous files were destroyed.

## Consequences

Before final illustration, Kira must establish and load the locked contract. An initial exploration may precede approval, but is not a finished illustrated edition. If Canva is the only available generator and real panel art is missing, the assistant reports that blocker instead of inventing scenes. Digest and file checks prove data provenance, not visual similarity or human approval authenticity; actual visual continuity still requires editorial review. The contract does not retrieve lost chat messages or images absent from storage.
