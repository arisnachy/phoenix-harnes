# Agent Note: Phoenix Auto latest-family execution and independent review

Status: implemented

English | [中文](2026-09-29-phoenix-auto-latest-family-review.zh.md)

## Problem

Phoenix Auto was selectable under OpenAI Codex, but its concrete routes were fixed to `gpt-6-sol` and `gpt-6-luna`. A newer Sol or Luna advertised by Codex therefore required a code change. The previous delegation policy also let Luna workers execute in parallel but did not guarantee a fresh independent Luna review followed by a Sol final decision, especially for visual work such as games and 3D.

## Decision

Phoenix Auto now resolves the newest advertised Sol and Luna generations from the live OpenAI Codex model catalog. The synthetic selector remains `Phoenix Auto`, while the concrete provider model ids are refreshed at selection time and again before each new turn. Astra is never considered by this resolver.

The execution contract is:

1. the newest Sol plans and orchestrates;
2. the newest Luna at Max performs the heavy execution;
3. the root Luna may add at most one independent Luna execution worker when parallelism shortens the critical path;
4. deterministic tests and checks run before model review;
5. one fresh Luna reviewer is launched through `workflow` with a prompt beginning `PHOENIX_AUTO_REVIEW`;
6. that reviewer audits without editing and returns a compact PASS/FIX digest;
7. the router detects the completed review and sends the next model step to Sol for the final decision;
8. if Sol requests correction, Luna executes it and review repeats only after material changes.

For games, 3D, websites, and other visual deliverables the reviewer is instructed to inspect rendered screenshots or running output when tooling permits; a successful build alone is not sufficient evidence.

Full presets retain a hard ceiling of two delegated workflow agents. Their child routes keep `gpt-6-luna` as a compatibility fallback but inherit the live parent Luna id when it matches the Luna family, so a newly adopted Luna generation also propagates to subagent, fork, and workflow children.

## Consequences

Phoenix Auto can adopt future Sol/Luna generations without manual router edits, while keeping Sol usage concentrated on planning, rescue, and final judgment. Luna handles execution and first-pass independent review, preserving the intended quality/cost balance. Existing direct model selections keep their previous behavior.
