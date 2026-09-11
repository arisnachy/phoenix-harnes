# @phoenix-ai/dsh-goal-round-driver

English | [中文](README.zh.md)

Same-session continuation driver for [`ctx.goals`](../goal/README.md). It turns an active, armed goal into sequential [goal rounds](../../../docs/glossary.md#goal-round) through the public `Agent` and session services; the [same-session driver Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-same-session-goal-round-driver.md) owns the race and lifecycle rationale.

## Composition

```yaml
- id: goal
  name: '@phoenix-ai/dsh-goal'

- id: tool-goal
  name: '@phoenix-ai/dsh-tool-goal'

- id: goal-round-driver
  name: '@phoenix-ai/dsh-goal-round-driver'
```

The plugin has no tunable configuration. `maxGoalRounds` belongs to the goal definition, while the model-facing blocked threshold belongs to [`dsh-tool-goal`](../tool-goal/README.md); duplicating either value in the driver could produce divergent policy.

## Mission finality invariant

The driver never decides that a mission is complete because time elapsed, a model stopped talking, a turn ended, tokens ran out, a continuation window reached its cap, or a worker claimed success. Those are execution boundaries only. In the base PHOENIX composition, [`dsh-tool-goal`](../tool-goal/README.md) automatically reviews every normally completed autonomous goal round. The goal becomes `complete` only after the exact revision has passing executable completion-gate evidence and an independent supervisor/judge PASS. Any other outcome leaves durable unfinished state for another strategy, recovery, or external-dependency wait.

This separation is deliberate: the round driver owns persistence and continued execution; the supervisor owns quality and finality. There is no mission-level stopwatch and no global maximum-round count that can convert unfinished work into DONE.

## Round contract

When an exact live agent is idle with an active, armed goal and remaining capacity, the driver first checkpoints pending goal mutations, then reserves `roundsStarted + 1` for the current `{ goalId, revision }`. It queues one `<goal_round>` prompt with `GoalMessageSource`. The `agent/pre-step` listener verifies the complete claimed record and current goal both before and after downstream listeners; only an entered `user/message` increments `roundsStarted`. A reservation rejected as stale does not consume the round number. When the window reaches `maxGoalRounds`, the driver persists a continuation checkpoint, rotates the goal revision, resets the window counter, and immediately drives the new window; it never turns the mission into a round-limit failure.

`MessageId` identifies the reserved message through durable inbox insertion and claim; it does not identify a turn result. Human messages do not consume the goal cap. If human work enters the inbox before a reservation or joins its pending batch, automatic work yields until the agent becomes idle; a pending automatic prompt in a mixed batch is rejected and re-reserved only after that checkpoint.

The retained prompt names the JSON-quoted objective and `round/maxGoalRounds`, treats the current workspace, tool results, and durable session state as authoritative, requires evidence before completion, and tells the model to use a materially different strategy after the first unsuccessful round. A question result marked `automatic: true` is explicitly a step decision only; it cannot complete, cancel, or block the active mission, and the model must continue or change strategy. It leaves the goal active when work remains. Quoting preserves multiline or tag-like objective text as data. Goal lifecycle mutations still require the independent authority checks in `dsh-tool-goal`.

## Idle checkpoint

At whole-agent idle, durable goal phase and revision are authoritative. An active, armed goal with capacity reserves its next round; completion, pause, blocking, and edits suppress continuation. A cap opens a fresh active revision instead of completing or blocking the mission. The driver does not treat the preceding activity's duration or attempt boundary as finality. A normal completed autonomous turn is handed to the supervisor layer before the turn closes; a `max-tokens` turn is explicitly not a completion candidate. Provider errors and token limits remain attempt-level outcomes.

## Lifecycle and durability

`goal/changed` creates a durability obligation. Before queuing work, the driver awaits `ctx.sessions.flush()` and rechecks both the goal revision and competing input after the await. A flush failure arriving through `agent/error` disarms continuation before another round can start.

Activation is never inherited when this plugin loads over an existing agent. `GoalService.disarm()` removes process-local authority without changing durable phase, revision, or history. On `agent/session-start`, the driver replays an active goal, re-establishes process-local continuation authority, and schedules recovery; blocked goals remain waiting for their external condition or an explicit resume. The same durable state survives session resume and fork.

Cancellation removes pending inbox work or leaves an agent-wide aborted state. At the next idle checkpoint the driver pauses a goal with a reserved or admitted attempt so cancellation cannot auto-restart it; cancellation unrelated to a goal attempt only disarms process-local continuation. If the pause mutation fails, the driver falls back to disarming. Plugin teardown closes admission, disarms every live goal, cancels active work with the `parent` cause, and awaits the driver plus agent quiescence while its event fence remains installed.

## Model Experience

### Goal-round prompt

#### What the model sees

Each admitted round is one retained user-role `<goal_round>` block naming the full objective and positive round number. Earlier human messages, goal-state snapshots, assistant output, and tool records remain in the same session history.

##### Goal-round protocol

```markdown
The model receives the complete objective and positive round number in the retained `<goal_round>` block. It must continue useful work, change strategy after unsuccessful attempts, and treat difficulty or an attempt boundary as unfinished work rather than mission completion.
```

##### Judge feedback

```markdown
When the previous completion judge returned needs_changes or blocked, the driver reconstructs that result from the durable goal/judge event and places its bounded findings and required changes in the next round prompt. This survives process restart and is consumed by the automatically resumed active mission. A non-PASS review is recovery input, never DONE.
```

##### Supervisor checkpoint

```markdown
The driver also writes bounded goal/supervisor checkpoints. A checkpoint records the exact goal revision, admitted round count, supervisor status, next action, and a redacted failure summary. On session start the latest checkpoint is replayed before an active mission is driven again. Mission completion itself remains gated by exact executable evidence plus independent PASS.
```

##### Strategy selection

```markdown
Before each admitted continuation, the driver records one strategy selection in goal/strategy and includes it in the prompt. The bounded rotation is baseline, verification-first, alternate-tool, and minimal-change; the next selection is deterministic and never repeats the immediately previous strategy.
```

#### Token effect

One fixed instruction block plus the objective is added per admitted round. Later requests resend retained rounds until compaction shadows them; no fresh agent or copied conversation prefix is created.

#### KV Cache effect

Append-only within an epoch: each admitted round extends the existing conversation after its reusable prefix. Compaction may replace the derived-history suffix and move the reusable boundary.

## Known Limitations and Deferred Work

- **Judge provider policy is separate** — `dsh-tool-goal` owns the independent read-only judge, automatic completed-round review, and final PASS decision; this package only replays its findings and keeps execution moving.
- **Same-session execution only** — this package deliberately does not spawn a fresh agent, fork a session prefix, or implement Ralph-style independent attempts; that workflow belongs to its own plugin layer.
- **Accepted-queue unload race** — Cordis plugin unload is asynchronous. A goal prompt already accepted by the agent inbox can begin and consume its round before unload starts; teardown then cancels the request, disarms the goal, and awaits quiescence. No later round starts.
- **Round cap is per window, not a mission budget** — token, currency, time, and provider quota policies remain independent attempt/runtime concerns. The cap rotates the goal revision and cannot terminate the mission.
- **Recovery distinguishes work from external dependency** — ordinary max-token and recoverable provider failures remain unfinished attempts and schedule more goal work. A real persistence failure or concrete external dependency may put execution into a waiting/disarmed state, but that state is explicitly not mission completion and retains durable state for later recovery.
