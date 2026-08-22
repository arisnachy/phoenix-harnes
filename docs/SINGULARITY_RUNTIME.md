# PHOENIX Singularity Runtime

PHOENIX uses **singularity** as an engineering direction: a local-first harness that can observe its own outcomes, compare alternatives, preserve memory, recover from provider failure, propose better routing policies, and adopt an improvement only after deterministic evidence gates and explicit approval.

It does **not** claim AGI, consciousness, autonomous authority, or unrestricted self-modification.

## Closed evolutionary loop

```text
provider/API/local model discovery
            ↓
capability registry + conservative defaults
            ↓
request / mission
            ↓
capability-aware routing
            ↓
agent loop ──→ policy-gated tools
    │
    ├────────→ durable local memory
    │
    └────────→ execution ledger + observations
                         ↓
                  Benchmark Arena
                         ↓
                  Singularity Lab
                         ↓
        candidate better with enough evidence?
                  │               │
                 no              yes
                  │               ↓
               reject       approval required
                                  ↓
                         AdaptiveRoutingPolicy
                                  ↓
                            canary / use
                                  ↓
                                rollback
```

## Local-first organs

### Provider Discovery

`discoverOpenAICompatible()` queries an OpenAI-compatible `/models` endpoint and builds a provider definition. Discovered capabilities are conservative by default. A model is not granted tools/reasoning merely because its name resembles another model.

### Universal Provider Manifest

`phoenix.providers.example.json` demonstrates a local manifest. API credentials are referenced by environment-variable name, never stored in the manifest or ledger.

### Local Memory

`LocalMemoryStore` persists append-only JSONL records under `.phoenix/` by default. It supports namespaces, episodic/semantic/checkpoint memory, tags, metadata and deterministic lexical retrieval without requiring a cloud database.

### Tool Fabric

`ToolRegistry` separates model intent from execution authority. Tools declare a risk class (`read`, `write`, `network`, `exec`). Policy can deny tools, allow only risk classes, or require an asynchronous approval callback before execution.

### Agent Runtime

`AgentRunner` is provider-agnostic. An agent is data: instructions, tool names, requirements, preferences and turn limit. Tool-call history is preserved correctly across model turns.

### Local Scheduler

`LocalScheduler` runs one-shot or recurring missions in a local process. `tick()` is deterministic for tests and embedding; `start()` provides an in-process clock.

### Benchmark Arena

`BenchmarkArena` runs the same scenarios against an exact provider/model target using model-level routing exclusions. Each sample records success, score and latency.

### Singularity Lab

`SingularityLab` compares baseline and challenger evidence. Promotion requires minimum samples, minimum success rate, minimum quality improvement and bounded latency regression.

Every promotion proposal has `requiresApproval: true` and a rollback plan.

### Adaptive Routing Policy

After approval, `AdaptiveRoutingPolicy` changes PHOENIX routing preferences to the evidence-backed target. The active target is visible in request metadata and ledger events. `rollback()` restores the previous target.

## Evolution invariants

1. Discovery is fail-closed about unknown capabilities.
2. Credentials never enter the execution ledger.
3. A model can propose tool use but cannot bypass tool policy.
4. Benchmark evidence is separated from production claims.
5. A challenger cannot self-promote.
6. Promotion is reversible.
7. Provider/model choices remain replaceable; no vendor is part of PHOENIX identity.
8. Every important routing/execution decision remains auditable.

## Road to deeper autonomy

Future layers should preserve these invariants while adding durable scheduler state, semantic/vector memory adapters, native Anthropic/Gemini adapters, sandboxed shell/filesystem tools, MCP, distributed workers, replayable missions, canary routing, automatic regression suites and signed policy bundles.
