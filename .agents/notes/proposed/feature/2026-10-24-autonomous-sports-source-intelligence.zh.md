# Agent Note: Autonomous sports source discovery and local analytics preview

Status: proposed

## Problem

Phoenix has general tools but no production sports source registry with verified provenance, bookmaker odds and sport-specific match presentation. Unverified sources could mislead users or expose keys.

## Proposal

A local Sports Studio preview reads configured ESPN, MLB and The Odds API sources, normalizes events and odds, and simulates tickets without placing wagers. Discovery is limited to known provider catalogs. Newly discovered leagues require human approval. The service enforces fixed host allowlists, response size limits, source authorization and source failure quarantine. Provider quality measures request behavior, not winning probability.

Production integration requires a complete Cordis capability and UI extension, provider licensing, tests and snapshots. The standalone preview is not a production menu integration.

## Alternatives considered

**Unrestricted web crawling.** Rejected because it creates SSRF, untrusted semantics and licensing risks.

**One JSON model for all sports.** Rejected because sport-specific entities and statistics differ.

**Guaranteed winning-ticket engine.** Rejected because no valid predictive guarantee is possible from bookmaker odds alone.

## Acceptance criteria

The preview passes Node 22 syntax and keyless tests, uses no synthetic live data and keeps credentials on the server. Production needs provider adapters, calibrated models, image permission review and end-to-end validation.

## Risks

Source interfaces may change, quotas may be exceeded, and missing coverage may block selected sports. Source quality scoring does not imply profitable betting. Data rights must be assessed independently.
