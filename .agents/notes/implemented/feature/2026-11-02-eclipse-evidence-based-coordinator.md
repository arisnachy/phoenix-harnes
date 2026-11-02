# Agent Note: Evidence-gated Eclipse coordination with Terra and Luna

Status: implemented

English | [中文](2026-11-02-eclipse-evidence-based-coordinator.zh.md)

## Problem

A sustained Terra coordinator and fixed Luna Max specialists can consume substantial tokens even when only a small portion of the work needs coordination. A user-reported comparison improved output quality from 76% to 86%, but spent 22% of a five-hour allowance and 6% of a weekly allowance. Those quota shares are observations, not an API token count, a reproducible benchmark, or an attribution to one model.

## Decision

Automatic Eclipse retains Luna as the default operational coordinator. A configured, account-visible Codex Terra route replaces a Luna model request only when a fresh Team result, nontrivial question, review, or decision arrives. The selection occurs in an existing request step, not an extra consultation. A turn admits at most two Terra interventions, reuses the same route for retries of one step, and does not reprocess the same Team message. Trivial formatting questions, routine tool receipts, and Sol planning or rescue do not route to Terra. The explicit coordinator preference is never interpreted as a permanent Terra route in Automatic mode.

Automatic Eclipse keeps Luna at Max for every model request served on Kira's Luna route, including the Sol-to-Luna execution handoff, and keeps Luna teammates at Max instead of changing their effort based on task heuristics. The legacy Codex Sol-to-Luna handoff also uses Max. Terra continues to substitute only an evidence-gated Team decision, never as a standing coordinator. Hybrid and Manual routes preserve the user's explicit model and effort selections. Eclipse Settings permits choosing the preferred Terra model and its account-advertised effort without changing Automatic to Hybrid. The serving model always stays within the selected Codex provider, and the Lead identity remains Kira.

## Alternatives considered

**Always coordinate on Terra.** Rejected because ordinary tool steps would continue to pay for a coordinator without new decisions.

**Switch models at fixed step intervals.** Rejected because elapsed steps and tool-call counts are not evidence of a coordination need.

**Disable Sol and all independent reviews.** Rejected because difficult strategy changes and risky modifications still need proportional verification.

**Force Terra Low globally.** Rejected because model effort availability comes from the live account catalog, not a hardcoded assumption.

## Consequences

Evidence-based coordinator substitutions do not add model turns, although an individual Terra request may have different token usage than a Luna request. A Team with no substantive messages stays on Luna Max, and at most two distinct Team messages in a turn can select Terra. Enforcing Max also for simple Luna requests can spend more reasoning tokens; it is a quality-first owner preference rather than an evidence-backed saving. The planned Sol-to-Luna transition preserves the single Kira identity but still depends on a visible plan and correct session event handoff. Session-level usage by model, first-pass task quality, total tokens, latency and interventions remain the necessary evaluation measures. This change alone does not demonstrate a reduction in the user's five-hour or weekly quota.

## Verification

Focused tests cover fresh and duplicate Team evidence, the two-intervention cap, Sol rescue preservation, provider restrictions, Luna Max through operational and conversational Automatic routes, Max teammate dispatch, explicit Hybrid/Manual selections, and editing the preferred Terra model while remaining in Automatic mode. CI and an assembled-session benchmark are required before claiming a measured reduction in token usage or higher result quality.
