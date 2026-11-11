# Agent Note: Open sports research with an editorial native ticket

Status: proposed

## Problem

PHOENIX can return five sports selections as Markdown without the native ticket experience. Its structured ticket carries per-leg favorable and adverse evidence, but favorable evidence and source links have not been visible at first glance. A fixed catalog also risks being mistaken for an exhaustive list of legitimate sources, despite other general web tools potentially being available.

## Proposal

Activate sports-specific instructions that explicitly authorize discovering additional legitimate web sources when relevant, without implying that an absent provider field means the information does not exist. Investigate both participants and reconcile official injury reports, fixture identity, lines, and contradictory evidence. Publish individual compact explanations with provenance and retain the first-party `sports_ticket_card` whenever produced.

The client presents validated favorable and adverse information and a bounded number of directly linked observed sources adjacent to the individual selection rationale. Detailed checklists remain expandable. The model guidance cannot provision a missing search provider; discovery depends on the actual permitted search/read tools at runtime.

## Alternatives considered

**Only format Markdown.** This would reproduce a pleasant screenshot but would lose the durable native ticket, tracking, market identities, and structured explanations.

**Hard-code another list of domains.** This would preserve a fixed ceiling and fail when a credible local reporter or official team announcement covers a fact outside the list.

**Convert arbitrary model prose to sportsbook quotes.** This has no reliable identity, bookmaker, period or publication provenance, and could present invented information as observed.

## Acceptance criteria

- The active sport-only system prompt includes autonomous source discovery, bilateral reasoning, citation and native-ticket display instructions.
- A validated sports ticket shows favorable reasons, adverse evidence and linked, reported sources without expanding the checklist.
- Existing sources with `missing` status, absent URLs or invalid ticket UI do not become presented as verified citations.
- Existing 5- and 6-leg card recovery, quote semantics and unrelated assistant conversations remain unchanged.
- Focused tests, runtime/build checks and a real-tool screenshot replay must pass before declaring production readiness.

## Risks

The guidance depends on tool availability and does not itself add general web search capabilities. News links and provider observations still require independent source validation, and the presence of a formatted analysis cannot imply a moneyline is executable or a predicted winner certain.
