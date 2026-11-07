# Agent Note: Universal source-aware visual entities

Status: implemented

## Problem

PHOENIX could render metrics, charts and tables in `ui_canvas`, but the generic renderer lacked image-backed entities, results with contextual symbols, and a sufficiently broad icon vocabulary. Sports could use specialized logo cards, while clinical, scientific and business answers still fell back to anonymous tables or repeated text. There was no generic schema for sourced imagery in a conversational canvas.

## Decision

Add 28 fixed, locally rendered outline icons for sports, clinical care, research, education, finances and organization. The generic `ui_canvas` schema now accepts a compact `entity` row with optional status, badge, outcome, detail, icon and media; an `image` figure with alternate text, fitting and visible source; and a contextual icon on a metric. Existing composition, local filtering, tabs, buttons and security bounds remain unchanged.

Only HTTPS images from a small fixed allowlist of public media CDNs can load in the canvas, and image-backed nodes require explicit source attribution. The client also rejects unknown keys, unapproved image hosts, malformed URLs, missing attribution, duplicate controls and hostile actions. Failed images fall back to fixed local icons; they never become assumed verified evidence. The allowlist does not independently verify a claim: Kira must retrieve and check image provenance before displaying it.

Kira's standard preset explains when to prefer structured conversational visuals and how to emit the validated schema, with text-only fallback when sources are missing. The layouts use theme tokens, responsive sizing and compact information hierarchy.

## Alternatives considered

**Accept arbitrary model-authored image URLs.** Rejected because images can track users, leak context to unknown domains and misrepresent unsupported evidence.

**Build a separate NBA-specific result template.** Rejected because it would not address universal clinical, scientific, education and business use cases.

**Add an icon font or duplicate a React render framework.** Rejected to avoid new network requests, startup cost and second interaction authority.

## Consequences

The UI vocabulary is broader without unbounded React/HTML injection or fabricated official logos. Real logos still depend on an authorized verified source and a supported CDN; arbitrary searches and image generation are not implemented by these renderer changes. Focused tests cover schema validation, contextual icons, rendering and URL rejection. Build, integration, accessibility and cross-browser verification remain distinct CI/QA obligations.
