# PHOENIX Continuity + Resource Runtime v10

PHOENIX v10 addresses two recurring long-running harness failures: context compaction that silently loses operational state, and agent/tool processes that consume resources without an enforceable allocation budget.

## Continuity-guarded compaction

The product feature is called **Zero-Loss Context**, but the implementation deliberately makes a narrower, testable guarantee: PHOENIX extracts explicit operational anchors before compaction and refuses to compact if required anchors cannot be represented within the continuity capsule budget.

Anchors include the latest user goal, explicit constraints (`must`, `never`, `do not`, `required`, etc.), recent/live tool transactions, decisions, failures, tests, file references and next actions. Required anchors are preserved with fingerprints. Optional anchors are selected by priority and recency.

A continuity capsule is bounded, contains clipped operational text rather than giant raw tool output, and is inserted after the primary system instruction. Existing capsules are removed before a new capsule is built so repeated compaction does not recursively grow context.

`compactAgentHistoryGuarded()` validates a weighted continuity score and requires 100% preservation of required anchors. If it cannot do that, it fails closed instead of pretending the session can safely continue.

`AgentRunner` uses guarded compaction automatically when its history exceeds the configured token budget and records only continuity scores/counts/fingerprints to the ledger, not the raw capsule.

This does **not** claim preservation of a model's hidden reasoning. The guarantee is preservation of explicit operational anchors required for mission continuity.

## Resource Governor

`ResourceGovernor` is a deterministic allocation governor, not an operating-system sandbox. It issues expiring leases and fails closed when requested allocation would exceed configured limits:

- concurrent agents
- concurrent MCP operations
- concurrent processes
- estimated RAM
- per-task CPU budget
- per-task wall-time budget
- output bytes

Expired leases are pruned automatically. AgentRunner acquires/releases an agent lease around each run. `HibernatingMcpBroker` can acquire/release an MCP lease around discovery/call operations, including failure paths.

The governor provides predictable admission control before PHOENIX later adds real OS/container enforcement in Sandbox Farm. Estimated RAM is planning telemetry; it is not a claim of kernel-enforced memory isolation.

## Security boundary

Resource leases never grant tool/security authority. The existing Security Membrane still controls whether an action is allowed; the Resource Governor independently controls whether there is enough bounded capacity to run it.

Continuity capsules are local runtime state. They do not re-enable peer-to-peer executable evolution or permit local evolution to rewrite PHOENIX source code.
