# `@phoenix-ai/dsh-hardness-adapters`

English | [中文](README.zh.md)

Projects metadata from existing PHOENIX tools and skills into the HARDNESS Tool Atlas.

The adapters do not execute tools, load skill bodies, or grant permissions; each source registry retains authority.

The adapter separates host-owned indexing from model-facing tools. The host composition mounts `modelTools: false` to index capabilities and install the shared mission runtime once. Full agent presets mount `modelTools: true` to expose `hardness_run` and `connector_list` in their own scope without duplicating the shared HARDNESS registry. Minimal presets can therefore keep a deliberately small catalog.

## Model Experience

### Projected capability metadata and operating protocol

#### What the model sees

The model sees a stable capability catalog, the shared HARDNESS lifecycle guide, and a replayable audit trace while execution remains governed by PHOENIX.

##### HARDNESS mission guidance

```markdown
Consumers may expose stable capability identifiers such as `tool:<name>`, `skill:<name>`, and `openclaw:<id>` together with compatibility and verification state; execution remains behind PHOENIX approval and canonical registries.

When the canonical system-prompt service is mounted, this package installs the `hardness:operating-protocol` section. It gives every model the same lifecycle vocabulary and requires resolution, approval, verification, presentation, and evidence before a task is described as complete. The section also defines mission debt: pending requirements and technical capability gaps remain recovery work rather than a final handoff.

Tool projections may subscribe to `tools/change`; this keeps dynamically connected tools, including MCP tools, represented in HARDNESS while registrations are reversible. The internal `hardness_run` tool is excluded from that projection to prevent recursive routing.

Each live mission appends a secret-free `hardness/mission` trace to the calling session. The trace records terminal protocol states, capability identity, artifact/evidence references, and stable reason codes; `replayHardnessMissionAudit` reconstructs one call without replaying arguments, credentials, or provider error text.

## Mission Persistence Kernel

`MissionPersistenceKernel` keeps mission state separate from disposable work. Attempt, plan, tool, and strategy failures are recorded with a bounded fingerprint and never become a mission-level `FAILED` state. A blocked dependency opens `WALL_PROTOCOL`, persists the exact missing dependency, proposes bounded alternative routes, and leaves the mission resumable rather than allowing the failed attempt to masquerade as completion.

At start, the kernel locks the objective, deliverables, mandatory acceptance criteria, and quality requirements. Each criterion must advance through `PENDING`, `IMPLEMENTED`, `TESTED`, and `VERIFIED`. The kernel rejects repeated strategies, stores root causes and reusable solutions as `hardness/kernel` session events, and enters `VERIFYING` before review. Only an independent judge with criterion evidence and a passing quality gate can transition a mission to `DONE`; an explicit `cancel()` is the only alternative terminal action. A successful capability execution therefore remains progress evidence, not permission to close the mission.

The base profile supplies the `spawn` subagent provider to this judge. The child receives a bounded candidate summary, uses only read-only inspection tools, returns the structured verdict and evidence, and is disposed after every review. `needs_changes` keeps the mission active and exposes the required repair list; an unavailable judge leaves it blocked instead of silently accepting the artifact.

The model-facing `hardness_run` result makes recovery explicit. A blocked result is non-terminal and always includes `mission_status` (`ACTIVE`, `RECOVERING`, or `WAITING_EXTERNAL`) and `next_action` (`repair_and_replan`, `retry_with_alternative`, or `wait_for_dependency`). Technical gaps such as an absent capability, executable surface, or executor are normalized to `RECOVERING` even when a lower layer reported them as waiting; PHOENIX must inspect ATLAS and connector inventories, try a materially different route, then acquire or build the smallest governed helper that the runtime permits and test it before use. `WAITING_EXTERNAL` is reserved for a dependency PHOENIX cannot create or satisfy itself, such as direct human authorization, a credential controlled only by the user, a required physical action, or genuinely unavailable external infrastructure. The adapter defers this recovery instruction into the next model request so a technical blocker cannot be mistaken for mission completion.

The loopback `artifact/run` endpoint executes a code artifact only through the mounted isolated `CodeRuntime`. A successful or failed structured result is appended as `hardness/artifact` with the artifact and tool-call identities, so reopening the session replays the latest sandbox result. The universal client surface forwards cancellation to that runtime and reports missing or incompatible runtimes as errors; it never falls back to browser evaluation for code.

Inspect the need, resolve a verified capability, plan the operation, obtain approval, execute through the governed runtime, verify the artifact, present it, and record evidence before claiming completion.
```

##### Connector inventory

```markdown
The model also receives the read-only connector_list tool when the authorization or MCP connector seam is mounted. Authorization rows report registered flows, provider telemetry, and sanitized callable service metadata. MCP rows report server identity, transport, lifecycle status, stable reason code, and public tool names. The tool never begins authorization, grants permission, invokes a connection, or exposes credentials or transport configuration.
```

#### Token effect

The protocol section and capability metadata contribute model tokens; indexing source registries alone does not add prompt text.

#### KV Cache effect

The projected catalog is cache-friendly while source schemas, extension metadata, and verification state remain unchanged.

## Known Limitations and Deferred Work

- External extension execution remains governed by the Capability Broker and isolated package-host contract rather than being activated eagerly at startup.
- Durable mission tracing requires a live agent session; direct unit-level runner calls without one remain unrecorded and are not production proof.
