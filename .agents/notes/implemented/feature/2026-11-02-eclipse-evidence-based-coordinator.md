# Agent Note: Evidence-gated Eclipse coordination with Terra and Luna

Status: implemented

English | [中文](2026-11-02-eclipse-evidence-based-coordinator.zh.md)

## Problem

A sustained Terra coordinator and fixed Luna Max specialists can consume substantial tokens even when only a small portion of the work needs coordination. A user-reported comparison improved output quality from 76% to 86%, but spent 22% of a five-hour allowance and 6% of a weekly allowance. Those quota shares are observations, not an API token count, a reproducible benchmark, or an attribution to one model.

## Decision

Automatic Eclipse retains Luna as the default operational coordinator. A configured, account-visible Codex Terra route replaces a Luna model request only when a fresh Team result, nontrivial question, review, or decision arrives. The selection occurs in an existing request step, not an extra consultation. A turn admits at most two Terra interventions, reuses the same route for retries of one step, and does not reprocess the same Team message. Trivial formatting questions, routine tool receipts, and Sol planning or rescue do not route to Terra. The explicit coordinator preference is never interpreted as a permanent Terra route in Automatic mode.

Automatic Eclipse specialists use Medium effort for ordinary work and High for complex or exceptional work, instead of inheriting Max on every delegation. An explicitly named Max specialist or explicit reasoning setting remains honored. Hybrid and Manual routes preserve their previous fixed-model behavior. Eclipse Settings permits choosing the preferred Terra model and its account-advertised effort without changing Automatic to Hybrid. The serving model always stays within the selected Codex provider, and the Lead identity remains Kira.

## Alternatives considered

**Always coordinate on Terra.** Rejected because ordinary tool steps would continue to pay for a coordinator without new decisions.

**Switch models at fixed step intervals.** Rejected because elapsed steps and tool-call counts are not evidence of a coordination need.

**Disable Sol and all independent reviews.** Rejected because difficult strategy changes and risky modifications still need proportional verification.

**Force Terra Low globally.** Rejected because model effort availability comes from the live account catalog, not a hardcoded assumption.

## Consequences

Evidence-based coordinator substitutions do not add model turns, although an individual Terra request may have different token usage than a Luna request. Ordinary teammates spend a lower reasoning tier by default in Automatic mode. A Team with no substantive messages stays on Luna, and at most two distinct Team messages in a turn can select Terra. The budget can trade away some first-attempt reasoning quality on difficult delegated work; comparative benchmarks must establish whether the quality gain persists. Session-level usage by model, first-pass task quality, total tokens, latency and interventions remain the necessary evaluation measures. This change alone does not demonstrate a reduction in the user's five-hour or weekly quota.

## Verification

Focused tests cover fresh and duplicate Team evidence, the two-intervention cap, Sol rescue preservation, provider restrictions, explicit Max specialist overrides, and editing the preferred Terra model while remaining in Automatic mode. CI and an assembled-session benchmark are required before claiming a measured reduction in token usage or higher result quality.
