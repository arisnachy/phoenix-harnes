# Agent Note: Kira adaptive team capacity and searchable model selection

Status: implemented

English | [中文](2026-10-13-kira-adaptive-team-model-search.zh.md)

## Problem

The Team runtime admitted only two simultaneous specialists although some saved configurations requested three. A long model catalog required manually opening provider groups and scrolling through hundreds of models. Model-specific planning and escalation guidance could be mistaken for a provider change or fabricated team discussion.

## Decision

`packages/subagent/agent-team/src/index.ts` accepts one to three concurrent specialist teammates under the Kira Lead, with three as the default ceiling. Capacity remains a limit, not a quota: routine requests use no team, independent delegated work starts with one specialist, difficult parallel work may use two, and only three independent scopes justify three.

`packages/subagent/tool-agent-team/src/index.ts` keeps real directed peer messages and evidence-gated handoffs. Fénix Eclipse plans and escalates through Sol and delegates execution to Luna Max; an explicitly selected Codex model remains Kira's planning and escalation model while teammates use Luna Max; outside Codex, every teammate inherits the current model and provider. The Phoenix Auto router in `packages/core/agent/src/model-selection.ts` retains the currently configured Sol as the Kira Lead at high after the first Sol xhigh plan; only real blockers temporarily elevate Sol to xhigh. Luna Max remains the separate teammate execution route. Small talk keeps the existing low-latency Luna fast path. The Team policy must not invent worker messages, provider switches or rescue calls.

The model dropdown gains a local search above provider groups in `packages/client/ui-model-selection/src/client/ModelSelect.tsx`. Filtering matches provider names, model names, identifiers and visible display names, automatically exposes matching providers while typing, and preserves the original selection and the normal accordion when cleared. Search neither triggers model requests nor changes the provider.

## Alternatives considered

**Always allocate three workers.** It raises cost and increases collisions without independent scopes. Adaptive admission stays supervised.

**Force all planners onto Sol.** A non-Eclipse user model and non-Codex provider remain authoritative; a global Sol override would violate the selected route.

**Replace the model directory with a server-side search.** The loaded catalog already contains searchable names and ids. A local filter avoids latency and extra authentication.

## Consequences

The runtime can now maintain Kira plus three real specialists. Provider policy and available models still determine live performance, and no automatic team participation is invented for routine tasks. Large catalogs are searchable without altering existing provider grouping. Tests cover the third-worker admission, fourth-worker rejection, provider search, model search and empty query results. End-to-end authenticated model behavior remains a separate verification requirement.
