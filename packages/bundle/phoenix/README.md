# @deepseek-ai/dsh-phoenix

PHOENIX profile bundle for DeepSeek Harness. Apply it after the standard base profile to mount the PHOENIX adaptive runtime and the official Codex and Claude Code subagent bridges.

The bundle does not grant Codex, Claude Code, or any newly discovered model command authority. PHOENIX ranks models by demonstrated capabilities, keeps new models provisional, and applies local policy/ROI/security gates around the existing DSH seams.

## What the bundle mounts

- `@deepseek-ai/dsh-phoenix-runtime`
- `@deepseek-ai/dsh-subagent-codex`
- `@deepseek-ai/dsh-subagent-claude-code`

The runtime adds capability-ranked routing, bounded cross-provider failover, Token Flight Recorder, Agent ROI Gate, local policy evolution, quarantine, and Mother Guard.

## Model Experience

### PHOENIX Genesis composition

#### What the model sees

The bundle itself contributes no independent prompt text. Any model-visible behavior belongs to the child packages it mounts; the PHOENIX Runtime policy layer adds no mandatory prose by default.

#### Token effect

Indirect through mounted children. The bundle carrier itself adds zero direct request tokens; PHOENIX Runtime's deterministic routing/ROI policy does not require another model request.

#### KV Cache effect

The bundle is a composition carrier. Its own patch-list adds no request text, but changing the mounted package set can change the composed request prefix or available tool surfaces and therefore cache reuse.

## Known Limitations and Deferred Work

- **Repository cognition** — Genesis does not yet include Repo Brain.
- **Parallel execution** — Sandbox Farm orchestration is deferred.
- **Model teams** — Model Team Genome and automatic benchmark arena are deferred.
- **Desktop surface** — the Windows PHOENIX application/Flight Deck is deferred.
- **Collective evolution** — there is no collective observe-only transport, and the profile deliberately contains no peer-to-peer executable evolution path.
