# `@phoenix-ai/dsh-hardness-adapters`

English | [中文](README.zh.md)

Projects metadata from existing PHOENIX tools and skills into the HARDNESS Tool Atlas.

The capability index does not execute tools, load skill bodies, or grant permissions; each source registry retains authority.

The adapter separates host-owned indexing from model-facing tools. The host composition mounts `modelTools: false` to index capabilities and install the shared mission runtime once. Full agent presets mount `modelTools: true` to expose `hardness_run`, `connector_list`, and durable scheduled-task tools in their own scope without duplicating the shared HARDNESS registry. Minimal presets can therefore keep a deliberately small catalog.

## Local assistant mailbox

The resident Web host can enroll a Phoenix-owned inbox on AgentMail's included `agentmail.to` domain from Settings → Connectors → Correo propio de Phoenix. Signup returns the actual provider address; verification sent to the nominated human owner must finish before incoming mail becomes work. An existing free-domain account can instead be connected with its API key and a separate owner challenge. Secrets stay in the credential service, outside chat, account files and status replies. No custom domain, paid upgrade or public webhook is provisioned.

Only provider-authenticated incoming mail from the verified owner or explicitly configured contacts creates a job. Automatic messages, Phoenix's own mail, blocked/spam/unauthenticated messages and unlisted senders do not invoke a model. Email contents cannot grant permissions. Kira executes in a dedicated persisted session using the selected coordinator's model, workspace and preset; existing worker selection and normal approval/finalization gates apply. `phoenix_mail_complete` records a verified reply proposal; it cannot send mail or complete another session's job. Replies target the authorized sender, overriding Reply-To and excluding CC.

Reception belongs to the local host, not the browser. Closing the chat leaves it running; shutting down the PC stops execution. On startup, polling reconciles missed mail and persisted jobs. Outgoing WebSocket notifications reduce latency and reconnect after interruption. Invalid message reads do not starve other jobs; failed reads are retried on later polls. Windows desktop installs optionally create/remove only the owned **PHOENIX Assistant** login shortcut, using the durable installation root and a hidden background launch without opening the browser.

Local configuration: `mailDirectory` defaults to `phoenix-mail` beside the task ledger; `mailCredentialRef` defaults to `PHOENIX_AGENTMAIL_API_KEY`; `mailPollMs`, `mailTimeoutMs` and `mailWorkTimeoutMs` default to 60,000, 30,000 and 600,000 milliseconds. Account, job and outbox files use serialized atomic private writes. Existing-account verification expires after 24 hours or ten attempts. Ambiguous signup is never automatically repeated. Reply and scheduled-email retries retain identical persisted content and idempotency keys; after the provider's 24-hour idempotency window an unconfirmed send is held for owner review rather than risking duplication. Provider quota stops work without a paid upgrade. Model usage retains its normal costs and limits.

Home attention stores receipts beside the task ledger. Opening or dismissing a current suggestion hides that exact revision across reloads; new material revisions remain eligible. Receipts are applied before the eight-row endpoint limit. A successful newer run supersedes an old failure. Completed email results and concrete blockers join the existing home feed without a new dashboard.

Scheduled host email checks mailbox readiness before model work and reuses any persisted occurrence without regenerating its body. Each outgoing message retains its task and occurrence identities. Every retry rechecks durable task state and recipient authorization; paused, cancelled, completed or missing tasks cannot send pending mail, while prior attempt evidence remains intact. Conditional email completes only after provider confirmation. Ambiguous deliveries beyond the 24-hour provider window require owner review and are excluded from automatic task retries. Host disposal cancels provider requests, drains owned sends, and rejects new sends. User-selected sender identities continue through their governed connector.

## Durable proactive tasks

Phoenix owns one process-shared task engine per durable ledger. By default the ledger is `~/.dsh/phoenix-tasks.json`; writes are atomic and the JSON file is created with user-only permissions where the platform honors POSIX modes. Model-facing scopes and the host runtime share the same in-process engine so they never cache competing snapshots of one task file.

`phoenix_task_create` schedules user-requested or Phoenix-initiated future work. One-shot tasks, anchored interval recurrence, and calendar-safe yearly recurrence are supported. Yearly recurrence accepts an IANA timezone so birthdays and anniversaries remain on the intended local calendar date across leap years. `phoenix_task_list`, `phoenix_task_pause`, `phoenix_task_resume`, and `phoenix_task_cancel` provide the model-facing management surface.

Every occurrence has a stable idempotency key and immutable execution history. A task found in `running` state after a restart is recovered to `scheduled`. If the computer was off at a due time, catch-up policy controls recovery: `latest` runs only the latest missed occurrence, `all` replays bounded missed occurrences, and `skip` advances past old work. Recurrence stays anchored instead of drifting from the time Phoenix happened to restart.

A task may use `visibility: surprise`. It is omitted from ordinary listings until its reveal time (or, for a recurring surprise without an explicit reveal time, until the current delivery occurrence). Optional private preparation can run a configured lead time before delivery and its bounded result is passed into the reveal step. Surprise content remains present in the durable internal ledger for recovery and audit; the feature is presentation-private, not an unaudited secret channel.

The host polls the durable engine and also pumps it when an agent is created. Chat delivery wakes a live target agent with a proactive follow-up. Private preparation, scheduled office work, and email use a configured one-shot subagent provider. If no live execution target exists, execution is deferred without consuming the occurrence.

Recurring `delivery: work` tasks can maintain an explicitly requested ongoing objective such as research, class preparation, project monitoring, or sports analysis. Execution revalidates reality and may use already-authorized MCP/connectors; a durable interest authorizes analysis, not external transactions. Material results enter a ranked, bounded loopback attention projection, unchanged recurring runs can return `NO_MATERIAL_UPDATE`, and the browser shows only the highest-value rows in the blank-session Hero. Optional task attention metadata controls whether results or upcoming occurrences participate without changing task execution.

Email has two independent identity references. `userMailIdentity` identifies the authorized mailbox used for office work sent on the user's behalf. `harnessMailIdentity` identifies Phoenix's own mailbox for direct communication with the user. A task chooses `user`, `harness`, or `auto`; `auto` prefers the Phoenix identity and falls back to the user identity. These references do not contain credentials and scheduled execution does not bypass normal mail-tool authorization or approval.

Relevant configuration keys are `taskLedgerPath`, `taskPollMs`, `privateWorkProvider`, `privateWorkResultChars`, `userMailIdentity`, and `harnessMailIdentity`. The special `:memory:` ledger exists only for deterministic tests and ephemeral compositions.

## Autonomous execution policy

Model-facing presets expose `hardness_workflow.executionMode` so Phoenix can distinguish bounded `fast` work from `standard` and `deep` missions before execution planning. For fast work, the assembled HARDNESS guidance is authoritative over generic methodology-skill ceremony: routine brainstorming or implementation-plan approval is not re-requested merely because a generic skill catalog lists those processes. Phoenix makes the smallest safe change and gathers fresh targeted verification; if evidence reveals failure, new risk, wider scope, external dependencies, or independent work, the workflow is strengthened rather than abandoned.

The same policy is reinforced in active goal rounds. An already-authorized mission continues through recoverable tool and verification failures using repair, alternate routes, capability acquisition/building, or a materially different strategy. Internal retry/round limits cannot complete or cancel the mission. Permission, credentials, safety policy, provider quota, explicit denial, and genuinely unsatisfied external dependencies remain hard boundaries and are never bypassed by the fast path.


## Runtime validation

Paper candle reads clamp both the provider request and returned rows to 1–1000. Shell mutation classification reads the command argument. Runtime-service telemetry performs an immediate first probe and then reuses observations until their TTL expires.

## Model Experience

### Projected capability metadata and operating protocol

#### What the model sees

The model sees a stable capability catalog, the shared HARDNESS lifecycle guide, a durable-proactivity guide, and a replayable audit trace while execution remains governed by PHOENIX.

##### HARDNESS mission guidance

```markdown
Consumers may expose stable capability identifiers such as `tool:<name>`, `skill:<name>`, and `openclaw:<id>` together with compatibility and verification state; execution remains behind PHOENIX approval and canonical registries.

When the canonical system-prompt service is mounted, this package installs the `hardness:operating-protocol` section. It gives every model the same lifecycle vocabulary and requires resolution, approval, verification, presentation, and evidence before a task is described as complete.

Model-facing scopes also install `hardness:proactivity-protocol`. It tells the model to use durable tasks for explicit reminders and useful autonomous follow-ups, turn explicit ongoing objectives into bounded recurring background work when useful, prefer authorized event-driven connectors over polling, suppress unchanged background results, preserve calendar timing, and keep all external actions behind the same authorization policy used for immediate work.

Tool projections may subscribe to `tools/change`; this keeps dynamically connected tools, including MCP tools, represented in HARDNESS while registrations are reversible. The internal `hardness_run` tool is excluded from that projection to prevent recursive routing.

Each live mission appends a secret-free `hardness/mission` trace to the calling session. The trace records terminal protocol states, capability identity, artifact/evidence references, and stable reason codes; `replayHardnessMissionAudit` reconstructs one call without replaying arguments, credentials, or provider error text.

The runner exposes an optional `HardnessMissionTelemetry` observer derived from those same audit rows. Its snapshot reports attempts, completed and blocked missions, recovery attempts, per-step outcomes, bounded latency totals/maxima, and stable blocked reason counts; `replayHardnessMissionTelemetry` rebuilds the metrics from durable rows. Telemetry is best-effort and cannot block a mission.

## Mission Persistence Kernel

`MissionPersistenceKernel` keeps mission state separate from disposable work. Attempt, plan, tool, and strategy failures are recorded with a bounded fingerprint and never become a mission-level `FAILED` state. A blocked dependency opens `WALL_PROTOCOL`, persists the exact missing dependency, proposes bounded alternative routes, and leaves the mission `WAITING_EXTERNAL` until `resume()` is durable.

At start, the kernel locks the objective, deliverables, mandatory acceptance criteria, and quality requirements. Each criterion must advance through `PENDING`, `IMPLEMENTED`, `TESTED`, and `VERIFIED`. The kernel rejects repeated strategies, stores root causes and reusable solutions as `hardness/kernel` session events, and enters `VERIFYING` before review. Only an independent judge with criterion evidence and a passing quality gate can transition a mission to `DONE`; an explicit `cancel()` is the only alternative terminal action. A successful capability execution therefore remains progress evidence, not permission to close the mission.

The kernel resolves protocol disputes with the immutable order `safety > approval > goal > judge > router > executor > presentation`. Distinct authorities record the higher layer without bypassing that layer's own gate; equal authorities fail closed in `WAITING_EXTERNAL`. Each resolution is appended as an `authority-conflict` event and replay restores both the conflict record and resulting status. Approval denial records `approval` versus `executor` before the blocked result, so a late executor outcome cannot override the broker. The shipped rationale is recorded in the [mission authority precedence Agent Note](../../../.agents/notes/implemented/architecture/2026-09-15-hardness-mission-authority-precedence.md).

The runner always has a local deterministic judge. It mechanically verifies artifact identity, rendering, durable evidence, and mandatory criteria in `TESTED` or `VERIFIED`; it returns `needs_changes` rather than passing incomplete evidence. When the base profile supplies the `spawn` subagent provider, the stronger semantic judge is used instead. That child receives a bounded candidate summary, uses only read-only inspection tools, returns the structured verdict and evidence, and is disposed after every review. `needs_changes` keeps the mission active and exposes the required repair list; an unavailable semantic judge leaves it blocked instead of silently accepting the artifact.

The model-facing `hardness_run` result makes recovery explicit. A blocked result is non-terminal and always includes `mission_status` (`ACTIVE`, `RECOVERING`, or `WAITING_EXTERNAL`) and `next_action` (`repair_and_replan`, `retry_with_alternative`, or `wait_for_dependency`). The adapter also defers a durable recovery instruction into the next model request, so a tool failure cannot be mistaken for mission completion or justify a new plan-mode approval loop.

The loopback `artifact/run` endpoint executes a code artifact only through the mounted isolated `CodeRuntime`. A successful or failed structured result is appended as `hardness/artifact` with the artifact and tool-call identities, so reopening the session replays the latest sandbox result. The universal client surface forwards cancellation to that runtime and reports missing or incompatible runtimes as errors; it never falls back to browser evaluation for code.

Inspect the need, resolve a verified capability, plan the operation, obtain approval, execute through the governed runtime, verify the artifact, present it, and record evidence before claiming completion.
```

##### Connector inventory

```markdown
The model also receives the read-only connector_list tool when the authorization or MCP connector seam is mounted. Authorization rows report registered flows, provider telemetry, and sanitized callable service metadata. MCP rows report server identity, transport, lifecycle status, stable reason code, and public tool names. The tool never begins authorization, grants permission, invokes a connection, or exposes credentials or transport configuration.
```

##### X MCP activation

```markdown
Full model-tool scopes also expose `x_mcp_activate`. It is usable only after an explicit user request and one-shot medium-risk approval. The user identity maps to `x-api`; the Phoenix-owned identity maps to `x-api-phoenix`, so their OAuth sessions stay separate. If the Phoenix-owned account does not exist yet, activation returns `setup-required`, defers an instruction to continue through Computer Use at `https://x.com/signup`, and stops for required human verification before connecting the resulting username. Setup never posts, follows, DMs, or performs another social action.
```

#### Token effect

The protocol sections, task-tool schemas, and capability metadata contribute model tokens; indexing source registries alone does not add prompt text.

#### KV Cache effect

The projected catalog and proactivity protocol are cache-friendly while source schemas, extension metadata, verification state, and visible tool definitions remain unchanged.

## Known Limitations and Deferred Work

- External extension execution remains governed by the Capability Broker and isolated package-host contract rather than being activated eagerly at startup.
- Durable mission tracing requires a live agent session; direct unit-level runner calls without one remain unrecorded and are not production proof.
- Legacy scheduled email identities remain configuration references requiring authorized mail tools. The local assistant mailbox separately enrolls an included-domain AgentMail account; live signup and verification require the owner and provider availability. Incoming task text is bounded; attachments are not automatically executed.
- Surprise visibility hides unrevealed content from ordinary task listings and compact tool presentation, but the durable ledger intentionally remains auditable to an authorized operator.
