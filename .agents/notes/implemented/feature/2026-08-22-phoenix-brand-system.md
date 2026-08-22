# Agent Note: PHOENIX brand system

Status: implemented

## Problem

This downstream repository is PHOENIX, but the shipped web presentation still used the upstream DeepSeek Harness whale, wordmark, browser title, PWA name, and favicon. That made the product identity contradict the runtime and repository identity and forced one upstream composite mark to serve surfaces with different size requirements.

## Decision

The official browser-brand occupants now present PHOENIX while retaining the upstream npm package identity needed for DeepSeek Harness synchronization. The sidebar and conversation hero receive a responsive phoenix SVG mark whose `size` comes from the owning slot. The sidebar name receives an independent PHOENIX SVG wordmark so small mark sizing never scales a large composite logo.

The web shell publishes `PHOENIX` as its default document title and PWA name, and `/favicon.svg` uses the same phoenix silhouette. Build-time `DSH_CLIENT_TITLE` remains supported as an explicit title override.

The phoenix uses existing amber and red design tokens inside React presentation instead of introducing a parallel theme palette. Internal `@deepseek-ai/dsh-*` package names, commands, and implementation vocabulary remain technical upstream identities and are not treated as user-visible branding.

## Alternatives considered

**Rename every DeepSeek Harness package and command.** Rejected because a visual identity change does not justify breaking upstream synchronization, workspace imports, CLI commands, documentation links, and package ownership in one blast-radius change.

**Ship the generated high-resolution composite image directly in every slot.** Rejected because one raster composition scales poorly between a 24 px sidebar mark and a large hero, inflates the client payload, and couples the wordmark to the emblem. The generated artwork remains the visual reference while the shipped UI uses a responsive SVG system.

**Keep the whale and only change the browser title.** Rejected because the primary visible mark would still identify the product as DeepSeek Harness.

## Consequences

PHOENIX now has one coherent user-visible identity across sidebar, hero, browser tab, favicon, and installed PWA metadata while preserving the DeepSeek Harness implementation foundation underneath. The SVG mark stays crisp across host-requested sizes and does not require a binary asset pipeline. The trade-off is that the detailed cinematic artwork is simplified for runtime UI surfaces; promotional artwork can remain richer without becoming the small-size application mark.
