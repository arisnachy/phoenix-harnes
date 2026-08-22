# @arisnachy/phoenix-continuity

English | [中文](README.zh.md)

PHOENIX Continuity owns durable **Memory Genome** entries and **Mission Graph** state while reusing DeepSeek Harness storage. It does not create a second database, agent loop, workflow engine, or background-job runtime.

## What it owns

- `ctx.phoenixContinuity` — the host service for memory and mission state.
- `phoenix_continuity` — a native `storageDomain` with `memories` and `missions` tables.
- Memory Genome — bounded, explicitly written memories with provenance and deterministic lexical recall.
- Mission Graph — validated acyclic task graphs with durable ready/running/succeeded/failure/pivot transitions.
- Never-Stop history — an exhausted task becomes `pivot-required`; a pivot preserves the old task as blocked history and rewires dependents to the replacement instead of erasing the failed route.

The deployment must provide explicit ceilings for record bytes, memory count, mission count, recall results, mission tasks, task attempts, and query bytes. Reaching a capacity limit fails closed. Memory is never silently evicted.

## Execution boundary

Mission Graph is **state, not an executor**. This package never starts a model, subprocess, workflow, job, or subagent. A later PHOENIX orchestration consumer may claim a ready task and hand execution to native DSH `workflowEngine`, `jobs`, or `subagents`, then commit the outcome back through `ctx.phoenixContinuity`.

Memory Genome likewise does not auto-inject memories into prompts. Recall is an explicit local lookup, so stored history does not become permanent request-context overhead.

## Model Experience

### Continuity state service

#### What the model sees

Nothing by default. `ctx.phoenixContinuity` is a host service and this package registers no model-facing tool or prompt section. A future consumer can expose bounded operations without changing the durable state contract.

#### Token effect

Zero direct request-context tokens. Memory recall is lexical and local; Mission Graph transitions are deterministic state operations. No embedding or model request is issued by this package.

#### KV Cache effect

No prompt prefix is added or rewritten, so the package itself does not invalidate model KV cache. A future consumer that chooses to present recalled memory owns that prompt/cache cost explicitly.

## Safety and durability

Records are schema-validated at the `storageDomain` read boundary. Mutations are serialized, the backend commits before in-memory visibility, complete serialized records are byte-bounded, and returned snapshots do not expose the storage domain's mutable object aliases.

## Known Limitations and Deferred Work

- Memory retrieval is lexical/structural only; no embedding index is included.
- Mission Graph does not execute work; workflow/job integration belongs to a separate consumer.
- No model-facing memory or mission tools are included in this first continuity cut.
- No distributed replication or peer-to-peer executable evolution is provided.
