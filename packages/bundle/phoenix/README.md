# @deepseek-ai/dsh-phoenix

PHOENIX profile bundle for DeepSeek Harness. Apply it after the standard base profile to mount the PHOENIX adaptive runtime and the official Codex and Claude Code subagent bridges.

The bundle does not grant Codex, Claude Code, or any newly discovered model command authority. PHOENIX ranks models by demonstrated capabilities, keeps new models provisional, and applies local policy/ROI/security gates around the existing DSH seams.

## What the bundle mounts

- `@deepseek-ai/dsh-phoenix-runtime`
- `@deepseek-ai/dsh-subagent-codex`
- `@deepseek-ai/dsh-subagent-claude-code`

The runtime adds capability-ranked routing, bounded cross-provider failover, Token Flight Recorder, Agent ROI Gate, local policy evolution, quarantine, and Mother Guard.

## Model Experience

The bundle adds no mandatory prompt text. Codex and Claude Code remain dormant providers until the existing DSH subagent layer delegates work to them. PHOENIX policy is deterministic where possible so idle overhead stays small.

## Known Limitations and Deferred Work

This first PHOENIX profile does not yet include the desktop application, Repo Brain, Sandbox Farm orchestration, Model Team Genome, automatic benchmark arena, or a collective observe-only transport. It deliberately contains no peer-to-peer executable evolution path.
