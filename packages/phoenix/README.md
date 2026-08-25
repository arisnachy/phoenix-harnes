# phoenix/ — PHOENIX evolution layer

English | [中文](README.zh.md)

PHOENIX is the downstream evolution of DeepSeek Harness in this repository. Packages in this group add provider-neutral intelligence, safety, efficiency, continuity, and self-improvement while reusing DSH's mature capability seams.

| Package | Role | ctx key |
|---|---|---|
| [`runtime/`](runtime/README.md) | capability ranking, adaptive routing, failover, token flight recording, Agent ROI, local evolution, Mother Guard | `phoenix` |
| [`ai-bus/`](ai-bus/README.md) | provider-neutral compute lanes, free-route policy, OrcaRouter/Ollama presets | `phoenixAiBus` |
| [`repo-brain/`](repo-brain/README.md) | incremental repository map, structural retrieval, reverse import impact | `phoenixRepoBrain` |
| [`continuity/`](continuity/README.md) | durable Memory Genome and Mission Graph state over native storage-domain | `phoenixContinuity` |

## Design rule

Prefer an existing DSH service/hook over a parallel implementation. PHOENIX replaces a DSH component only when the replacement is evidence-backed and remains compatible with upstream synchronization.

Cost, capability, authority, repository knowledge, execution confinement, and durable memory remain separate seams. A cheap model is not automatically trusted; a repository index is not a sandbox; an observation is not authority evidence.
