# Agent Note: Autonomous sports source discovery and local analytics preview

English | [中文](2026-10-24-autonomous-sports-source-intelligence.zh.md)

Status: proposed

## Problem

Phoenix has general tool and provider orchestration, but no native sports data capability with provenance, documented source approval, bookmaker odds, and sport-specific presentation. An unverified source registry could mislabel unreliable feeds as predictors of outcomes and leak provider credentials.

## Proposal

A dependency-free, loopback-only Sports Studio preview in `scripts/phoenix-sports-*.mjs` reads configured ESPN, MLB and The Odds API feeds, normalizes event and odds payloads, and exposes a source registry plus local ticket simulation. Discovery is constrained to known provider catalogs, with new ESPN league candidates explicitly approved before scoreboard access. Response validation, fixed host allowlisting, timeouts, source authorization and failure quarantine protect the local host. Source quality is computed from request observations rather than being called win probability.

Production integration requires a Cordis capability with a separate provider, service and consumer, a configurable model-facing tool, a Phoenix UI surface, documented permission policy, backend regression and transcript snapshots, and an auditable provider contract for additional licensed sources. The separate studio is deliberately not presented as production integration.

## Alternatives considered

**Direct unrestricted web discovery.** Rejected because arbitrary source URLs enable SSRF, prompt injection, unreliable semantics and unknown legal conditions.

**One generic JSON adapter for every sport.** Rejected because baseball pitchers, tennis rounds, MMA fights and league standings have incompatible resource models.

**Automatic winning-ticket generation.** Rejected because odds alone do not establish calibrated predictive probability, correlation structure or positive expected value.

## Acceptance criteria

The preview must pass syntax and zero-key regression tests; the UI must report unavailable data rather than fabricate it; secrets remain on the server; new sources require explicit review. Production completion requires all necessary provider adapters, image permissions, calibration, browser integration and end-to-end verification.

## Risks

Undocumented endpoints may disappear, rate-limit or change fields. The score quality monitor measures availability, not predictive skill. Tickets are estimates of payouts, not orders. Provider media reuse and data storage need separate rights review. Existing workspace documentation and coverage policies remain merge requirements.
