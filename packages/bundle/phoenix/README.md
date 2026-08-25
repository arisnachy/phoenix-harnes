# @deepseek-ai/dsh-phoenix

PHOENIX profile bundle for DeepSeek Harness. Apply it after the standard base profile to mount the adaptive runtime, cost-aware AI Bus, zero-model-call Repo Brain, and the official Codex and Claude Code subagent bridges.

The bundle does not grant Codex, Claude Code, OrcaRouter, Ollama, or any newly discovered model command authority. PHOENIX keeps cost, capability, and authority separate: the capability ladder remains the trust gate.

## What the bundle mounts

- `@deepseek-ai/dsh-phoenix-ai-bus`
- `@deepseek-ai/dsh-phoenix-repo-brain`
- `@deepseek-ai/dsh-phoenix-runtime`
- `@deepseek-ai/dsh-subagent-codex`
- `@deepseek-ai/dsh-subagent-claude-code`

The bundle also configures the existing dormant `@deepseek-ai/dsh-llm-pi-ai` seam with the explicit `orcarouter/free` route. Credentials are referenced through `ORCAROUTER_API_KEY`; no credential is stored in this package.

The runtime adds capability-ranked routing, bounded cross-provider failover, Token Flight Recorder, Agent ROI Gate, local policy evolution, quarantine, and Mother Guard. AI Bus classifies compute cost lanes without granting trust. Repo Brain adds deterministic repository retrieval and reverse dependency impact without issuing model calls for indexing or search.

## Model Experience

### PHOENIX composition

#### What the model sees

The bundle itself contributes no independent prose. Model-visible content comes from the child packages it mounts: Repo Brain owns its repository guidance/tool, while the existing subagent packages own their own model-facing contracts.

#### Token effect

Indirect through mounted children. AI Bus adds zero direct context; Repo Brain contributes its documented prompt/tool surfaces; dormant subagent bridges add only the effects defined by their owning packages when reachable.

#### KV Cache effect

The bundle is a composition carrier. Cache behavior is the combination of its mounted packages; changing bundle composition can change the stable request prefix and available tool schemas.

## Known Limitations and Deferred Work

This v13 profile does not yet include Sandbox Farm orchestration, Memory Genome/Rebirth, Model Team Genome, automatic benchmark arena, MCP hibernation/Toolsmith, desktop Flight Deck, or collective observe-only transport. It deliberately contains no peer-to-peer executable evolution path and no silent paid-provider fallback.
