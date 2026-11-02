# Agent Note: Evidence-gated Eclipse FÉNIX consultations with Terra and Luna Max

Status: implemented

English | [中文](2026-11-02-eclipse-evidence-based-coordinator.zh.md)

## Problem

A sustained Terra coordinator and fixed Luna Max specialists can consume substantial tokens even when only a small portion of the work needs coordination. A user-reported comparison improved output quality from 76% to 86%, but spent 22% of a five-hour allowance and 6% of a weekly allowance. Those quota shares are observations, not an API token count, a reproducible benchmark, or an attribution to one model.

## Decision

Automatic Eclipse retains Luna Max as the only Kira execution coordinator. FÉNIX is a deterministic evidence gate and a scoped, lead-only `fenix_consult` tool. It never silently substitutes Terra for the Lead. A configured Codex Terra route is used only after a real Team message reports a substantive contradiction, failed verification, missing requirement, or integration risk, and Kira explicitly submits its message id and one narrow question. Successful consultation launches a fresh temporary Terra teammate that reports one focused review to Luna; at most one consultation is admitted per turn and a durable `team/fenix-consult` event prevents repeated calls after rehydration. No account-visible Terra route means no consultation. This additional expert call consumes tokens; the gate itself uses no model call.

Automatic Eclipse keeps Luna at Max for every model request served on Kira's Luna route, including the Sol-to-Luna execution handoff, and keeps Luna teammates at Max instead of changing their effort based on task heuristics. The legacy Codex Sol-to-Luna handoff also uses Max. Terra is a separate one-shot consultation when evidence justifies it, never a substitute for Kira's Lead route. Hybrid and Manual routes preserve the user's explicit model and effort selections. Eclipse Settings permits choosing the preferred Terra model and its account-advertised effort without changing Automatic to Hybrid. The serving model always stays within the selected Codex provider, and the Lead identity remains Kira.

## Alternatives considered

**Always coordinate on Terra.** Rejected because ordinary tool steps would continue to pay for a coordinator without new decisions.

**Switch models at fixed step intervals.** Rejected because elapsed steps and tool-call counts are not evidence of a coordination need.

**Disable Sol and all independent reviews.** Rejected because difficult strategy changes and risky modifications still need proportional verification.

**Force Terra Low globally.** Rejected because model effort availability comes from the live account catalog, not a hardcoded assumption.

## Consequences

The FÉNIX gate itself adds no model call, but a warranted temporary Terra consultation does consume extra tokens. A Team with no substantive risk evidence stays entirely on Luna Max, and at most one consultation is admitted per turn. Enforcing Max also for simple Luna requests can spend more reasoning tokens; it is a quality-first owner preference rather than an evidence-backed saving. The planned Sol-to-Luna transition preserves the single Kira identity but still depends on a visible plan and correct session event handoff. The existing 1,800-character specialist brief now preserves the beginning and end of a long durable plan, including trailing acceptance criteria, and labels the missing middle as an excerpt rather than pretending the fragment is complete. Session-level usage by model, first-pass task quality, total tokens, latency and interventions remain the necessary evaluation measures. This change alone does not demonstrate a reduction in the user's five-hour or weekly quota.

## Verification

Focused tests cover only genuine Team risk evidence, rejection of routine successes and fake messages, brief acceptance-criteria preservation, lead-only FÉNIX exposure, fail-closed behavior when Terra is unconfigured, Luna Max dispatch and Sol handoff. Model-specific token reduction and consultation quality are not yet proven. FÉNIX currently instructs the temporary Terra teammate to be analysis-only; this is a prompt boundary, not an independently enforced tool sandbox. CI and an assembled-session benchmark are required before claiming a measured reduction in token usage or higher result quality.
