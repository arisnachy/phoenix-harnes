# Agent Note: Truthful live image progress without invented percentages

Status: implemented

## Problem

The image-generation card previously computed a seemingly precise completion percentage from elapsed wall-clock time. Its visual progress could show 65% even when the image provider reported no percentage, conflating animation with measurement. It also timed from the beginning of the entire turn rather than from the tool call that generated the image.

## Decision

The conversation view recognizes a real, currently running image-generation tool using the existing projection. While the provider does not expose per-job progress telemetry in that projection, the card displays an accessible **indeterminate** animated activity bar, the observed running-tool state, and elapsed time anchored to the actual tool-call timestamp. It does not expose `aria-valuenow`, an estimated remaining percentage, or an estimated completion time.

The card is removed when the runtime no longer observes the running image tool. The existing completed image artifact or tool error remains the authoritative outcome. The animated bar respects reduced-motion preferences.

A provider-supplied numerical progress indicator requires a separate, provenance-bearing runtime progress contract and transport. Do not derive numerical completion from elapsed time, output dimensions, token counts, or speculative intermediate phases.

## Alternatives considered

- **Keep the exponential time estimate and label it "estimated"** — easy but looks like telemetry and is wrong for variable-duration image jobs.
- **Infer percentages from elapsed time or ordinary tool events** — events confirm that a call is running, not how much model inference or final verification remains.
- **Display 0% until completion** — deceptively suggests a provider progress measurement that does not exist.

## Consequences

- Users see only supported facts: the tool is running and how long it has run.
- The existing design keeps its motion and clear visual identity, without fictitious progress.
- The UI cannot display a true numeric percent until the provider and PHOENIX runtime actually publish verified progress events; adding that transport is future work.
- Tests assert that the indeterminate progressbar has no numeric `aria-valuenow` and that no percent is invented.
