# PHOENIX User Pain Runtime v9

PHOENIX v9 turns recurring complaints from coding-harness users into explicit runtime contracts.

## Token Flight Recorder

Every request can be forecast by source: system, user, assistant history, tool results and tool schemas. `PhoenixRuntime` records mission-level estimated input, actual input, cached input, output and avoided tokens. The goal is to make context consumption inspectable instead of mysterious.

## Agent ROI Gate

Subagents are not free intelligence. `AgentRoiGate` prefers deterministic work for simple tasks, local models when sufficient, a single specialist when justified, and parallel agents only when parallelism/specialization/context-isolation benefits clear a higher ROI gate. Maximum parallelism remains bounded.

## Never-Stop bounded resilience

`ResilientGenerationRuntime` classifies rate limits, quota failures, transient transport failures, terminal errors and cancellation. Retryable failures use bounded exponential backoff; repeated rate/quota failures trigger a checkpoint hook. Authentication, permission and invalid-request errors fail immediately instead of wasting quota. This is resilience, not an infinite retry loop.

## Memory Genome

`MemoryGenome` adds provenance, confidence, verification time, TTL and lifecycle state (`active`, `stale`, `disputed`, `retired`). New knowledge can supersede old knowledge. Expired or disputed memory is excluded from normal retrieval. The harness should not treat old memories as eternal truth.

## MCP Hibernate

`HibernatingMcpBroker` implements zero-start/zero-idle behavior around the MCP federation: wake only for discovery/call and close the connection after the operation by default. Server environment values are stripped on registration so a discovered/manual MCP cannot receive ambient credential configuration through this safe broker.

## Security boundary

These features do not change the existing rule that local evolution may optimize inert policies but may not rewrite PHOENIX source code or execute peer-supplied evolution payloads.

## Competitive thesis

The harness should be measured by correct work per unit of expensive intelligence, not by raw model prestige. PHOENIX aims to make model usage observable, route simple work away from frontier models, persist verified knowledge, sleep unused tools, and recover from transient provider failures without losing the mission.
