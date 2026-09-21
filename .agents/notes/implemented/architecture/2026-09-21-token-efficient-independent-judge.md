# Token-efficient independent judge

Date: 2026-09-21
Status: Implemented

## Motivation

External benchmarking showed that the independent completion judge improved PHOENIX output quality enough to beat the comparison harness, but total token usage was roughly doubled. The judge remains required where policy selects it; this change removes duplicated context and duplicated review work rather than weakening review.

## Decisions

1. Independent review remains a separate read-only agent. The judge never edits its own candidate and never self-approves a repair.
2. A dedicated `judge-spawn` provider uses the existing structured subagent contract with Git worktree isolation disabled.
3. Judge children use a compact complete system prompt and suppress dynamic runtime context. They do not receive the ordinary PHOENIX persona, AGENTS/skills context, or unrelated workflow guidance.
4. Ordinary completion review receives a compact evidence packet:
   - original request,
   - exact changed targets,
   - bounded mutation summaries,
   - bounded deterministic verification output.
5. The judge decides from the packet first. Read-only tools are fallback evidence acquisition, not the default path. Ordinary review exposes only `read`, `read_image`, `glob`, and `grep`.
6. `needs_changes` may return structured `repair_actions` containing path, issue, smallest requested change, and targeted verification. The original worker performs those repairs.
7. A repair re-review is differential. Accepted evidence from the first review is reused, and the fresh judge receives only later worker mutations/verifications plus unresolved findings.
8. Judge output is bounded independently from the worker. Ordinary review defaults to a 4096 output-token ceiling while preserving the selected model/provider and its reasoning quality.
9. Passing tests remain evidence rather than blanket proof. Error contracts, scale/resource claims, and explicit acceptance requirements remain mandatory where relevant.

## Expected effect

The quality gain from independent review is preserved while removing three major token/time multipliers: full PHOENIX prompt/context replay in the judge, judge-side workspace rediscovery, and full-task re-auditing after a targeted repair.

## Regression expectations

- `judge-spawn` is mounted without worktree isolation and with review isolation.
- Review-isolated child requests contain only the compact judge system prompt while structured output remains available.
- Ordinary judge packets carry exact changed paths and compact deterministic evidence.
- Ordinary judge tool scope excludes session/web rediscovery.
- A second judge pass is explicitly a delta review and reuses accepted prior evidence.
- A judge pass without concrete evidence fails closed.
- Repair actions are advisory to the worker; no judge-side mutation capability is introduced.
