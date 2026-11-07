# Agent Note: Visual Intelligence model JSON recovery

Status: implemented

## Problem

A real PHOENIX response on 2026-11-07 produced a fenced `visual_intelligence` object but surfaced a raw `generative-ui` code block rather than its interactive UI. The payload used `metrics[*].status:"normal"`, while the strict visual schema expects `"neutral"`. Generic fenced parsing also excluded `visual_intelligence` from its invalid-payload notice path, bare JSON discovery, and streaming draft suppression. This combination leaked rejected UI JSON as code to the user even though a later well-formed prompt rendered properly.

## Decision

Repair **only deterministic, low-risk semantic aliases** (such as normal→neutral, numerically typed metric values→strings, and common Spanish view labels) before passing the full object to the unchanged strict schema. Do not silently delete unrecognized properties or accept unsafe links, scripts, arbitrary action handlers, unsupported statuses or malformed arrays. Use own-property lookups for aliases, not prototype chain data.

Unify `visual_intelligence` with the existing generative UI pipeline for fenced recognition, safe visible notices on invalid finalized structures, detection of bare JSON objects and suppression of partial streaming drafts. Extend the **readable notice** fallback to every known generic/sports UI type, including `smart_card`, without changing their valid rendering schemas. Unknown JSON remains regular code for legitimate developer use. The auto-view resolver uses explicit intent only when the matching dataset is present; mixed metrics plus plots/tables default to a dashboard with selectable other views. Kira Max's response guidance documents the exact schema bounds and tells the model to avoid raw JSON walls.

## Alternatives considered

**Permit arbitrary model output as HTML or JSON without checking fields.** Rejected: would undermine security and execute unreviewed content.

**Keep rejected `visual_intelligence` blocks visible in the code viewer.** Rejected: a UX regression that exposes implementation data and hides a simple recoverable UI.

**Retry the LLM automatically until parsing succeeds.** Rejected: can create loops, cost, delay, fabricated data, or duplicate external actions. Deterministic repair and readable fallback are safer.

## Consequences

A model response with `status:"normal"` is no longer enough to hide the visual interface; a rejected dangerous or known invalid UI block yields a notice instead of a JSON wall. An LLM can still produce unsupported or semantically wrong data; no client parser can guarantee perfect generation. Tests cover screenshot-equivalent input, raw and fenced paths, streaming, view selection, and forbidden payloads. Full build and chat regression remain CI responsibilities.
