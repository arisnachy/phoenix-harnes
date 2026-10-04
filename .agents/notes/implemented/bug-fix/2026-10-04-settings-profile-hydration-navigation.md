# Agent Note: Settings profile hydration and responsive navigation

Status: implemented

## Problem

The Profile form could receive its first durable settings snapshot after construction, assign that snapshot as the comparison source, and then mistake the still-empty draft for a local edit. The visible form therefore stayed empty even though the Host already held the saved profile. The settings shell also used generic glyphs for Profile and Connectors and paid the cost of a full-viewport backdrop blur while switching potentially heavy sections.

## Decision

The Profile controller decides whether a local draft is dirty against the previous Host snapshot before accepting the incoming snapshot. A clean form adopts the incoming durable values; an actually edited form keeps its draft. The settings navigation maps Profile to the user silhouette and Connectors to a dedicated plug glyph. Section content follows a deferred active id so the selected navigation row can update before expensive destination content, and the modal mask keeps the existing dimming without backdrop blur.

## Alternatives considered

**Treat every incoming profile snapshot as authoritative.** This fixes reopening but would erase text the user is actively editing when a background settings refresh arrives.

**Keep the generic settings or personalization glyphs.** That avoids a primitive addition but leaves two high-frequency destinations visually ambiguous and does not match the product affordances.

**Keep backdrop blur and only add CSS transition hints.** Hints do not remove the full-screen compositor work; the settings mask does not need blur to preserve focus hierarchy.

## Consequences

Persisted profile values now reappear on first hydration and local edits still survive later Host refreshes. Profile and Connectors are visually identifiable from the navigation rail. Settings section changes remain functionally identical but schedule heavy body work after the urgent navigation state, while the mask no longer causes full-window blur repaints.
