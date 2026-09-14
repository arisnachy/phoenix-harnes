# `@phoenix-ai/dsh-hardness-adapters`

English | [中文](README.zh.md)

Projects metadata from existing PHOENIX tools and skills into the HARDNESS Tool Atlas.

The adapters do not execute tools, load skill bodies, or grant permissions; each source registry retains authority.

The adapter separates host-owned indexing from model-facing tools. The host composition mounts `modelTools: false` to index capabilities and install the shared mission runtime once. Full agent presets mount `modelTools: true` to expose `hardness_run`, `connector_list`, and durable scheduled-task tools in their own scope without duplicating the shared HARDNESS registry. Minimal presets can therefore keep a deliberately small catalog.

## Durable proactive tasks

Phoenix owns one process-shared task engine per durable ledger. By default the ledger is `~/.dsh/phoenix-tasks.json`; writes are atomic and the JSON file is created with user-only permissions where the platform honors POSIX modes. Model-facing scopes and the host runtime share the same in-process engine so they never cache competing snapshots of one task file.

`phoenix_task_create` schedules user-requested or Phoenix-initiated future work. One-shot tasks, anchored interval recurrence, and calendar-safe yearly recurrence are supported. Yearly recurrence accepts an IANA timezone so birthdays and anniversaries remain on the intended local calendar date across leap years. `phoenix_task_list`, `phoenix_task_pause`, `phoenix_task_resume`, and `phoenix_task_cancel` provide the model-facing management surface.

Every occurrence has a stable idempotency key and immutable execution history. A task found in `running` state after a restart is recovered to `scheduled`. If the computer was off at a due time, catch-up policy controls recovery: `latest` runs only the latest missed occurrence, `all` replays bounded missed occurrences, and `skip` advances past old work. Recurrence stays anchored instead of drifting from the time Phoenix happened to restart.

A task may use `visibility: surprise`. It is omitted from ordinary listings until its reveal time (or, for a recurring surprise without an explicit reveal time, until the current delivery occurrence). Optional private preparation can run a configured lead time before delivery and its bounded result is passed into the reveal step. Surprise content remains present in the durable internal ledger for recovery and audit; the feature is presentation-private, not an unaudited secret channel.

The host polls the durable engine and also pumps it when an agent is created. Chat delivery wakes a live target agent with a proactive follow-up. Private preparation, scheduled office work, and email use a configured one-shot subagent provider. If no live execution target exists, execution is deferred without consuming the occurrence.

Email has two independent identity references. `userMailIdentity` identifies the authorized mailbox used for office work sent on the user's behalf. `harnessMailIdentity` identifies Phoenix's own mailbox for direct communication with the user. A task chooses `user`, `harness`, or `auto`; `auto` prefers the Phoenix identity and falls back to the user identity. These references do not contain credentials and scheduled execution does not bypass normal mail-tool authorization or approval.

Relevant configuration keys are `taskLedgerPath`, `taskPollMs`, `privateWorkProvider`, `privateWorkResultChars`, `userMailIdentity`, and `harnessMailIdentity`. The special `:memory:` ledger exists only for deterministic tests and ephemeral compositions.

## Model Experience

### Projected capability metadata and operating protocol

#### What the model sees

The model sees a stable capability catalog, the shared HARDNESS lifecycle guide, a durable-proactivity guide, and a replayable audit trace while execution remains governed by PHOENIX.

##### HARDNESS mission guidance

```markdown
Consumers may expose stable capability identifiers such as `tool:<name>`, `skill:<name>`, and `openclaw:<id>` together with compatibility and verification state; execution remains behind PHOENIX approval and canonical registries.

When the canonical system-prompt service is mounted, this package installs the `hardness:operating-protocol` section. It gives every model the same lifecycle vocabulary and requires resolution, approval, verification, presentation, and evidence before a task is described as complete.

Model-facing scopes also install `hardness:proactivity-protocol`. It tells the model to use durable tasks for explicit reminders and useful autonomous follow-ups, avoid duplicates and spam, use private preparation for surprises, preserve calendar timing, and keep all scheduled external actions behind the same authorization policy used for immediate work.

Tool projections may subscribe to `tools/change`; this keeps dynamically connected tools, including MCP tools, represented in HARDNESS while registrations are reversible. The internal `hardness_run` tool is excluded from that projection to prevent recursive routing.

Each live mission appends a secret-free `hardness/mission` trace to the calling session. The trace records terminal protocol states, capability identity, artifact/evidence references, and stable reason codes; `replayHardnessMissionAudit` reconstructs one call without replaying arguments, credentials, or provider error text.

## Mission Persistence Kernel

`MissionPersistenceKernel` keeps mission state separate from disposable work. Attempt, plan, tool, and strategy failures are recorded with a bounded fingerprint and never become a mission-level `FAILED` state. A blocked dependency opens `WALL_PROTOCOL`, persists the exact missing dependency, proposes bounded alternative routes, and leaves the mission `WAITING_EXTERNAL` until `resume()` is durable.

At start, the kernel locks the objective, deliverables, mandatory acceptance criteria, and quality requirements. Each criterion must advance through `PENDING`, `IMPLEMENTED`, `TESTED`, and `VERIFIED`. The kernel rejects repeated strategies, stores root causes and reusable solutions as `hardness/kernel` session events, and enters `VERIFYING` before review. Only an independent judge with criterion evidence and a passing quality gate can transition a mission to `DONE`; an explicit `cancel()` is the only alternative terminal action. A successful capability execution therefore remains progress evidence, not permission to close the mission.

The base profile supplies the `spawn` subagent provider to this judge. The child receives a bounded candidate summary, uses only read-only inspection tools, returns the structured verdict and evidence, and is disposed after every review. `needs_changes` keeps the mission active and exposes the required repair list; an unavailable judge leaves it blocked instead of silently accepting the artifact.

The model-facing `hardness_run` result makes recovery explicit. A blocked result is non-terminal and always includes `mission_status` (`ACTIVE`, `RECOVERING`, or `WAITING_EXTERNAL`) and `next_action` (`repair_and_replan`, `retry_with_alternative`, or `wait_for_dependency`). The adapter also defers a durable recovery instruction into the next model request, so a tool failure cannot be mistaken for mission completion or justify a new plan-mode approval loop.

The loopback `artifact/run` endpoint executes a code artifact only through the mounted isolated `CodeRuntime`. A successful or failed structured result is appended as `hardness/artifact` with the artifact and tool-call identities, so reopening the session replays the latest sandbox result. The universal client surface forwards cancellation to that runtime and reports missing or incompatible runtimes as errors; it never falls back to browser evaluation for code.

Inspect the need, resolve a verified capability, plan the operation, obtain approval, execute through the governed runtime, verify the artifact, present it, and record evidence before claiming completion.
```

##### Connector inventory

```markdown
The model also receives the read-only connector_list tool when the authorization or MCP connector seam is mounted. Authorization rows report registered flows, provider telemetry, and sanitized callable service metadata. MCP rows report server identity, transport, lifecycle status, stable reason code, and public tool names. The tool never begins authorization, grants permission, invokes a connection, or exposes credentials or transport configuration.
```

#### Token effect

The protocol sections, task-tool schemas, and capability metadata contribute model tokens; indexing source registries alone does not add prompt text.

#### KV Cache effect

The projected catalog and proactivity protocol are cache-friendly while source schemas, extension metadata, verification state, and visible tool definitions remain unchanged.

## Known Limitations and Deferred Work

- External extension execution remains governed by the Capability Broker and isolated package-host contract rather than being activated eagerly at startup.
- Durable mission tracing requires a live agent session; direct unit-level runner calls without one remain unrecorded and are not production proof.
- Email identities are configuration references only; this package does not create external mailbox accounts. The selected provider/tool must already be configured and authorized.
- Surprise visibility hides unrevealed content from ordinary task listings and compact tool presentation, but the durable ledger intentionally remains auditable to an authorized operator.
