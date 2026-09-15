# PHOENIX Runtime

`@deepseek-ai/dsh-phoenix-runtime` is the first native PHOENIX intelligence layer inside the DeepSeek Harness tree. It deliberately reuses the DSH agent loop, LLM registry, token meter, tools pipeline, sandbox seams, durable sessions, compaction, jobs, and subagents instead of cloning them.

## What it adds

- **Model Capability Ladder** — role-specific ranking across planning, orchestration, reasoning, coding, debugging, research, tool use, critique, judging, security, reliability, and efficiency.
- **Authority ≠ capability** — newly discovered models are provisional; quarantined/provisional models never win PHOENIX routing. Orchestrator and judge roles have explicit high gates.
- **Automatic onboarding** — every model advertised through `ctx.llm` enters the ladder as provisional without making a paid call.
- **Role routing** — a deterministic zero-token classifier selects the role and `agent/request` may route to the highest qualified model for that role.
- **Never-Stop failover** — DSH's native provider retry gets first chance; if it declines a retryable failure, PHOENIX may switch to another independently qualified provider/model with a bounded retry count.
- **Token Flight Recorder** — each proposed step records token pressure and surface size from the native `ctx.tokenMeter`.
- **Agent ROI Gate** — trivial lookups are denied when they attempt to spawn another model process; use direct tools instead.
- **Local Evolution** — benchmark/operator evidence and quarantine state persist only under `$DSH_HOME/phoenix/local-evolution.json`. Mission observations can tune reliability locally but cannot grant orchestration/judging authority by themselves.
- **Mother Guard** — a monotonic tool guard refuses force-push, direct security/control-plane mutation patterns, and peer-supplied executable evolution.

## Safety invariants

PHOENIX never treats a provider label, model name, popularity, or frontier marketing class as authority. Role authority requires evidence. Collective evolution is observation-only: this runtime contains no peer execution transport and rejects peer-supplied executable evolution patterns. Local evolution mutates policy evidence, not source code.

The runtime does **not** claim to be an OS sandbox. DSH's sandbox packages remain the confinement seam. The runtime also does not claim to preserve hidden model reasoning during compaction; DSH's durable log/compaction machinery remains the continuity source of truth.

## Model Experience

The model sees no new prose by default. PHOENIX acts as policy around existing request/tool seams, so token overhead is near-zero until observability or future UI surfaces request flight/evolution state.

## Known Limitations and Deferred Work

The initial runtime has no automated quality benchmark suite, no pairwise Model Team Genome, no distributed Evolution Mesh transport, no Windows desktop shell, and no Repo Brain semantic graph yet. Those are separate PHOENIX layers and must preserve the same fail-closed authority boundary.
