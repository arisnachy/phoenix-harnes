# Agent Note: Premium model picker provider identity

Status: implemented

## Problem

The composer model picker exposed adapter-oriented catalog labels directly, so long technical names, preview dates, and inconsistent provider casing competed at the same visual weight. The menu could also grow around pathological ids and relied on native title tooltips for overflow. Provider identity was text-only, which made a large multi-provider catalog slower to scan.

## Decision

The composer model picker now keeps provider/model ids as the only routing facts while adding a presentation-only layer for the user-facing catalog. Known model labels are normalized into compact display names, preview/experimental suffixes move into secondary metadata, and Preview becomes a badge instead of part of the primary title. Provider headings use a consistent compact hierarchy and the model pane has a bounded scan-friendly width with horizontal overflow suppressed.

Known provider companies may render a lazily loaded logo from the Simple Icons CDN. The resolver uses a conservative allowlist of provider aliases; arbitrary custom gateway ids never produce guessed external requests. Every logo slot renders a local monogram first, so offline mode, blocked networks, CDN failures, and unknown providers degrade silently without changing model state, surfacing a toast, or delaying selection. Image failures hide only the failed image and leave the local fallback visible.

The native `title` attributes on the model trigger and model rows are removed. Accessible names use the same friendly display label while the underlying selection still submits the exact Host-advertised provider/model ids.

## Alternatives considered

**Keep raw adapter names and only adjust CSS.** This would preserve technical accuracy but would not solve the main scanning problem: backend-oriented suffixes and dates would still dominate the primary line.

**Fetch arbitrary provider favicons or infer company domains.** Rejected because custom/private gateways could cause speculative network requests, leak identifiers, or show incorrect branding. A fixed alias allowlist plus local fallback is predictable and fail-closed.

**Bundle every company logo in Phoenix.** Rejected because it increases shipped asset surface and requires manual asset updates. Lazy known-provider loading keeps the application small while the monogram fallback preserves offline behavior.

## Consequences

The picker is easier to scan without changing routing semantics or the Host model contract. Friendly-name heuristics remain presentation-only and may need extensions as new naming families appear. Known provider logos require network access to the icon CDN to replace their monograms, but logo availability is never required for model selection and failures remain silent.
