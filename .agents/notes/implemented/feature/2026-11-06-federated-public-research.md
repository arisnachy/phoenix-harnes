# Federated public research sources — 2026-11-06

## Context

The model-facing research service used one structured Europe PMC endpoint and a general web search path. Scientific and public-data questions require cross-disciplinary discovery with explicit metadata provenance and dependable failure states. A catalog entry alone cannot be treated as permission to query or as proof that a provider is operational.

## Decision

The existing tool-web plugin owns two additional model tools. `research_federated` concurrently queries five fixed public HTTPS metadata endpoints, enforcing a bounded request window, per-provider caps, strict DOI handling, cross-index deduplication, per-source failures, and no credential or redirect forwarding. `research_catalog` publishes a 100-source curated register for routing by field, but only `none` and `none_limited` entries count as eligible anonymous candidates. The existing `research_scholar` remains for detailed Europe PMC pagination and `research_investigate` remains responsible for actual document reading through the governed web service.

This isolates metadata search from methodological interpretation: neither citation counts nor providers' result order determine clinical or scientific validity. Unverified, credentialed, conditional and terms-restricted entries remain non-executable until adapter-specific policy and integration tests exist.

## Rejected approaches

Scraping Google Scholar, bypassing CAPTCHA, querying all 100 endpoints for every question, treating search records as full text, and silently upgrading anonymous sources to privileged APIs were rejected. Routing all literature to one biomedical endpoint would exclude most scientific domains.

## Verification

Unit coverage injects HTTP responses for provider projection, DOI deduplication, rate-limit partial success, redirect rejection, catalog access controls and input bounds. The package composition must also register the two tools alongside existing search tools; repository CI and production endpoint availability require independent checks.
