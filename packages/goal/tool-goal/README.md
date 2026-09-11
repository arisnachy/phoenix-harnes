# @phoenix-ai/dsh-tool-goal

English | [中文](README.zh.md)

The model-facing control tools for [`ctx.goals`](../goal/README.md): `get_goal`, `create_goal`, `update_goal`, `specialist_lab`, and `organization_forge`. The [goal-tool Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-model-facing-goal-tools.md) owns the authority split and Codex-shaped UX.

## Tools

- `get_goal()` returns the current goal or `null`, including the compare-and-set id/revision, durable phase, admitted/capped goal rounds, any blocker reason, and current process-local activation.
- `create_goal(objective, max_goal_rounds?)` creates one goal from a direct top-level human turn. The model may infer long-running goal intent without an exact command phrase; non-human turns and subagents are rejected at execution.
- `update_goal(goal_id, revision, action, objective?, max_goal_rounds?, blocked_reason?)` supports `edit`, `pause`, `resume`, `complete`, and `blocked`. Replacements belong only to `edit`; `blocked_reason` is required only for `blocked` and is persisted with the stable code `model-reported`. Strict-schema empty-string and zero fillers count as omitted, while meaningful values remain limited to their action.
- `specialist_lab(action, ...)` maintains a bounded, replayable laboratory for a requested topic. `start` creates the profile, then `source`, `hypothesis`, and `experiment` append evidence; `evaluate` records judge feedback and moves the profile to `ready`, `improving`, or `blocked`. A failed evaluation is not completion: the next bounded iteration must address the recorded changes.
- `organization_forge(action, ...)` maintains a modular organization build. Use `start`, then `research`, `source`, `audit`, `blueprint`, `deliverable`, `work`, `strategy`, `revalidate`, `atlas`, `block`, `advance`, `criterion`, and `judge` as the evidence requires. The result includes `nextAction`; failed work, repeated failure fingerprints, judge findings, and external blocks remain recoverable durable state. `management` is available only after a passing judge and verified criteria and deliverables, and then presents the required `Entregar`, `Gestión asistida`, or `Gestión autónoma` choice.

When `requireJudge` is enabled, `evaluate` invokes a fresh structured subagent with the same read-only review allow-list as goal completion. The judge receives the persisted laboratory evidence, and its verdict is stored in the specialist snapshot. A non-pass result is also deferred as model context so the next bounded cycle has the required changes without another user confirmation.

When `requireJudge` is enabled, the supervisor owns mission finality. Every autonomous goal round that reaches a normal `completed` turn boundary is independently reviewed even if the executor never calls `update_goal(... complete)`. The supervisor first requires the adversarial executable completion gate and then a fresh read-only semantic judge. `needs_changes` or `blocked` keeps the goal active and becomes durable recovery feedback; only an exact-revision PASS backed by the executable gate may call the goal domain's `complete` transition. A `max-tokens` boundary is attempt-level only and never triggers a completion decision. Legacy/custom emitters that omit a stop reason also fail closed and cannot trigger DONE.

The explicit `update_goal(... complete)` path remains supported for models that proactively request review. It uses the same independent gate and judge. If that exact autonomous round has already produced a durable `goal/judge` result, the turn-end supervisor does not duplicate the review.

All calls are exclusive, so a model-ordered batch observes earlier mutations and their new revisions. UI clients receive pure generic cards: read for `get_goal`, other for mutations. Mutation cards select the first meaningful action value and otherwise show the goal id, so accepted fillers never produce blank input.

All three canonical values match the compact JSON already rendered to Native callers: `{ goal: null }` or `{ goal: { id, revision, objective, phase, roundsStarted, maxGoalRounds, blockedReason? }, activation }`. Programmatic consumers therefore receive the same domain structure without parsing the rendered JSON.

An autonomous goal round that successfully reports `complete` or `blocked` marks that tool execution with `concludeTurn()` so the physical turn stops after the step. Direct-human mutations never contribute this stop: the assistant may acknowledge the change and concurrent human steering remains available to the loop. A physical turn stop is never itself mission completion; the supervisor/domain gate decides finality.

## Authority

Execution requires the exact live `exec.agent`, its inherited `AgentRegistry` initiator, running status, and an open turn. Create, edit, pause, and resume additionally require an accepted `{ kind: 'user' }` message or steering event in a runtime-root agent's current turn. Durable fork lineage does not demote a resumed root; live subagent ownership does.

`{ kind: 'user' }` is a host attestation. `Agent.followup()` and `steer()` assign it when their caller omits a source, so plugins, schedulers, and other non-human producers must pass their own source rather than inheriting human authority.

Complete and blocked also accept the exact current goal round: a goal-sourced `user/message` whose id, revision, and round equal the folded current goal. A goal-round blocked call is mechanically rejected until `blockedAfterConsecutiveRounds`; the model judges whether the same condition actually persisted and must describe it in `blocked_reason`. Direct human authority may stop a goal immediately.

## Config

```yaml
- id: tool-goal
  name: '@phoenix-ai/dsh-tool-goal'
  config:
    blockedAfterConsecutiveRounds: 3
    requireJudge: true
    judgeProvider: spawn
```

`blockedAfterConsecutiveRounds` must be a positive safe integer. Independent completion certification is enabled by default and should remain enabled; `requireJudge` is retained as an explicit deployment setting for compatibility, while the goal domain always rejects completion without a durable passing judge. `judgeProvider` names a fresh structured subagent provider. The base PHOENIX profile enables both judge fields.

## Model Experience

### System prompt

#### What the model sees

A fixed goal policy says when semantic human intent warrants creation, requires exact read-before-update refs, explains rearming after resume/fork, and limits completion/blocking claims. When enabled, it also tells the model that every normally completed autonomous round is reviewed automatically, self-reported completion remains active until independent verification returns `pass`, and token/round boundaries are not completion evidence. The configured blocked threshold is interpolated into that guidance.

##### Goal policy

```markdown
Use goal tools for one long-running completion objective in the current session. create_goal may infer goal intent from a direct human request in any language; do not create a goal for routine single-turn work. Call get_goal before update_goal and copy its exact goal_id and revision. After session resume or fork, the driver restores an active durable goal and continues it automatically. Mark complete only when the objective is actually achieved. Every autonomous goal round that reaches a normal completed boundary is reviewed automatically; executor prose alone cannot finish the mission. The independent read-only judge plus executable completion gate must return pass before completion is accepted. Use required_changes as the next work list. Token, turn, and continuation-window boundaries are attempt-level only, not mission completion. Mark blocked only for a concrete condition under the configured policy; difficulty, uncertainty, or useful remaining work is not blocked.
```

#### Token effect

Small fixed input cost on every request where this plugin's prompt registration is in scope.

#### KV Cache effect

Prefix-stable while the plugin scope, configured threshold, and guidance text are unchanged. Activation, disposal, or configuration changes may invalidate reuse from this prompt section.

### Tool schemas and results

#### What the model sees

The generated [`get_goal`, `create_goal`, and `update_goal` schemas](../../../docs/tool-catalog.md#phoenix-aidsh-tool-goal). Successful results are compact JSON. A mutation appends the goal domain's durable `goal/change` event without queuing model context. `activation` in a result is a live observation and never becomes replay authority.

#### Token effect

Fixed schema cost plus one compact result per call. The durable mutation adds no separate model-visible context.

#### KV Cache effect

Schemas are prefix-stable while their definitions and visibility are unchanged. Calls and results append after the reusable request prefix without invalidating earlier entries.

## Known Limitations and Deferred Work

- **Semantic intent remains model judgment** — execution can prove that the current turn contains a direct human message, not whether the request is substantial enough to merit a goal.
- **Same-condition blocking remains model judgment** — the runtime enforces distinct admitted-round count, not semantic equivalence of obstacles. The completion judge certifies the requested result, not semantic equivalence of blockers.
- **No scheduling or direct human rendering** — these tools mutate state only; the same-session driver and [`dsh-command-goal`](../command-goal/README.md) are independent consumers of the same domain.
- **Goal-round authority requires a driver** — automatic turn-end review applies to a goal-sourced autonomous round; mounting this tool package alone does not create continuation rounds.
- **Prompt registration is independent of filtering** — a scope may hide the tools while retaining their guidance unless the deployment scopes both registrations together.
