# `@phoenix-ai/dsh-hardness-adapters`

English | [中文](README.zh.md)

Projects metadata from existing PHOENIX tools and skills into the HARDNESS Tool Atlas.

The adapters do not execute tools, load skill bodies, or grant permissions; each source registry retains authority.

## Model Experience

### Projected capability metadata and operating protocol

#### What the model sees

The model sees a stable capability catalog, the shared HARDNESS lifecycle guide, and a replayable audit trace while execution remains governed by PHOENIX.

##### HARDNESS mission guidance

```markdown
Consumers may expose stable capability identifiers such as `tool:<name>`, `skill:<name>`, and `openclaw:<id>` together with compatibility and verification state; execution remains behind PHOENIX approval and canonical registries.

When the canonical system-prompt service is mounted, this package installs the `hardness:operating-protocol` section. It gives every model the same lifecycle vocabulary and requires resolution, approval, verification, presentation, and evidence before a task is described as complete.

Tool projections may subscribe to `tools/change`; this keeps dynamically connected tools, including MCP tools, represented in HARDNESS while registrations are reversible. The internal `hardness_run` tool is excluded from that projection to prevent recursive routing.

Each live mission appends a secret-free `hardness/mission` trace to the calling session. The trace records terminal protocol states, capability identity, artifact/evidence references, and stable reason codes; `replayHardnessMissionAudit` reconstructs one call without replaying arguments, credentials, or provider error text.

The loopback `artifact/run` endpoint executes a code artifact only through the mounted isolated `CodeRuntime`. The universal client surface forwards cancellation to that runtime and reports missing or incompatible runtimes as errors; it never falls back to browser evaluation for code.

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
