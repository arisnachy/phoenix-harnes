# Phoenix Universal Intelligence Engine 3.0 — implementation contract

This document covers the first integrated vertical slice of Phoenix Universal. The tool suite is mounted into the existing `@phoenix-ai/dsh-tool-web` plugin and respects the current `ctx.web` provider, credentials, timeout policy, AbortSignal and HARDNESS mission/authorization boundaries.

## Delivered in this change

- `research_sources`: inspect more than 20 domain-specific source families. These are **candidate search hosts**, not connected or authorized APIs.
- `research_search`: normalize the user's question, choose a domain, search once for recall and up to twice with scoped authoritative source hosts, deduplicate URLs, keep successful results during independent search failures, and return explicit status, partial failures and citations as source URLs.
- Extend the capability operating protocol to prefer native live data feeds for streaming sports, rates and weather and not to overstate web indexing.
- Unit tests cover domain routing, query limits, deduplication, provider failure, empty results and output limits.

## Next acceptance gates before calling the universal harness complete

1. Persist cross-model mission checkpoints independent of Sol/Luna sessions.
2. Map every committed action to real execution receipts and independent evidence; prevent false terminal success.
3. Provide independently authenticated API connectors for official sporting data, exchange rates, science, health, economics and many more domains.
4. Build a consent-governed OpenAPI/MCP discovery and contract-testing sandbox.
5. Optimize browser operator throughput using DOM/Playwright and measured progress; retain vision fallback and required approvals.
6. Validate research across languages, source date/freshness, source disagreement, official feeds and API quotas; test against real provider credentials.
7. Execute the full workspace typecheck, lint, unit/integration and Windows build gates. Do not label tests as passed unless the CI log proves it.
8. Keep `main` and `stable` at identical, verified commits.

## Explicit non-goals of this initial slice

It does not claim direct API access to all catalogued sources, automatic installation of arbitrary third-party code, certified live sports prices or real-time quotes. Search results remain leads until primary material is checked. Neither a model's confidence nor a successful tool invocation substitutes for delivery evidence. Costs and rate limits of current providers remain in force.

## Universal mission contract

Every request should become a verifiable objective, select the narrowest authorized capability, act using existing governed tools, retain checkpoints, recover transient faults, validate deliverables, disclose uncertainty and learn only from outcomes with reliable evidence. Autonomous external changes must pass the relevant permissions and user approval boundaries.
