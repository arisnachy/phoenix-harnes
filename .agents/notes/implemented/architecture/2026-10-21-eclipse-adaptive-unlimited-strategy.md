# Eclipse: independent planning and execution with evidence-driven reviews

## Problem

The former two-seat Eclipse settings editor mapped the legacy planner field into Kira's coordinator and forced a single model for planning, execution and recovery. The runtime also capped strategy rescues at two per turn, even when a complex mission produced more distinct blockers. A fixed cap changes the result for long-running implementation work, while removing all safeguards could create repeated, costly reviews without progress.

## Decision

Expose separate Codex routes for Kira's initial and follow-up planning, Kira's execution/coordination, and teammates. Keep Kira's identity and the existing session/event history across changes; switch only the request's serving provider/model/effort. An explicitly selected model outside Phoenix Auto is not rerouted.

The new `escalationSensitivity` setting is `adaptive` by default, `quality` to review complex failed tool actions sooner, or `economy` to omit automatic stall reviews while honoring explicit requests and Team blockers. The strategic consultation count is unlimited: a subsequent review requires a new Team blocker identity or new substantive execution evidence. Comparing normalized tool outcome content prevents consecutive identical failures from triggering repeated strategy calls. The existing generic prose-continuation cap remains separate to protect against endless promises without tool execution.

The new profile includes a sensitivity marker so older planner-only settings can still migrate to a coordinator choice without mistaking a newly configured planner-only profile for legacy state. Older specialist-specific routes are removed on save; the Team model stays separately configurable.

## Verification

Focused checks: UI settings round-trip with three model roles, independent settings schema validation, plan-versus-execution route selection, four distinct successive strategy reviews, unchanged-failure deduplication, and Web accessibility snapshot for the configurator.

## Limitations

The heuristic sees execution evidence reported in the current session; it does not predict task complexity perfectly or guarantee token savings. Cost/quality comparisons require real provider traces; local tests cannot establish an improvement in production. Provider failures and authorization guards still apply. The generic automatic continuation gate remains bounded independently of strategic reviews.
