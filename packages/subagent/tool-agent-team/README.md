# @phoenix-ai/dsh-tool-agent-team

English | [中文](README.zh.md)

Scoped model-facing adapter for [`ctx.agentTeams`](../agent-team/README.md). It installs the Agent Teams policy and collaboration tools in each implicit Lead and durable teammate scope. Scoped Team definitions shadow same-named legacy global continuable-subagent controls, so a composition that mounts both must disable the legacy definitions.

## Main conversation tools

`team_chat_read` exposes bounded canonical message ids and real public text to the exact Lead or direct child. `team_chat_react` sets or removes any valid Unicode emoji with the backend-authenticated actor identity. Generic direct children receive these chat tools without receiving Team task or roster authority. Assignments name the owner, deliverable, constraints and acceptance evidence; concise replies retain results and blockers, and changes after review require affected behavior to be checked again. Guidance requires sparse useful collaboration, no private reasoning in public messages, and Kira review before the final result; a shared model does not imply independent verification. Assignments address known teammates by their runtime names. Workers acknowledge real assignments in their first useful work update with a concrete next action in their own voice, without an extra acknowledgement turn; acceptance is never execution evidence. Missing discoverable facts trigger bounded tool-based investigation and alternative sources before asking the user. Historical evidence retains its requested cutoff; unavailable data is reported rather than invented. This guidance does not grant new capabilities or permissions.

## Config

```yaml
- id: tool-agent-team
  name: '@phoenix-ai/dsh-tool-agent-team'
  config:
    freshProvider: spawn
    forkProvider: fork
    modelProfiles:
      fast: { provider: openrouter, model: openrouter/free }
      judge: { provider: anthropic, model: claude-sonnet-4 }
```

`freshProvider` and `forkProvider` select registered continuable-subagent transports. Under OpenAI Codex, `modelProfiles` supplies configured worker routes and `defaultModelProfile` selects the bounded execution route when `spawn_teammate.model_profile` is omitted. Outside OpenAI Codex, every teammate inherits the exact currently selected provider and model even when a profile is requested. Kira retains her selected model for supervision and final verification; a worker's model route does not change its visible name or persona.

The Team policy calls a JUDGE cognitively independent only when its reported `modelProvider` or `model` differs from the Lead. A fresh child on the same route is operationally independent but remains correlated and must be reported as such.

## Tools and authority

The generated [tool catalog](../../../docs/tool-catalog.md#phoenix-aidsh-tool-agent-team) owns exact schemas. The adapter supplies teammate creation; quiet and waking peer delivery; roster listing, waiting, and Lead-only interruption; and task create/list/get/compare-and-set update operations.

Every tool requires the exact calling `Agent`. `spawn_teammate` and `interrupt_agent` enforce Lead authority inside `ctx.agentTeams`, not only in their descriptions. All members can communicate with any peer and use the task board. Task mutations retain the domain's owner/Lead and revision checks.

`send_message` succeeds once mail is durable and never wakes an inactive target. `followup_task` also makes the message the target's next turn and can cold-resume it. A `queued` result is accepted durable work and must not be retried. Task readiness does not start an owner. Before arming its 10,000-through-3,600,000-millisecond edge wait, `wait_agent` checks for another member that is running or provisioning; without one it returns `noProgress` immediately with instructions to re-list and use `followup_task`. Otherwise it waits for one post-call Team edge, defaulting to 30,000 milliseconds, and callers re-list after wakeup or timeout because earlier changes are not replayed.

`team_chat_answer` publishes a bounded answer only to a conversational user request actually accepted by the addressed child. Its stable `replyTo` correlation preserves the shared transcript while task completion still requires execution evidence. The policy gives such questions priority at the next safe boundary and then resumes the mission. Reactions are optional and add no mandatory model turns; delivered peer messages carry their usable identity in the existing sender header.

The plugin listens to Agent publication and installs its registrations through that Agent's scope. Fresh creation and cold resume therefore receive the same tool/prompt set before the first model request. Agent disposal and plugin HMR remove every scoped registration; reloading the plugin installs one fresh set in each still-live member without changing its continuation Activation.

## Model Experience

### Team policy and tools

#### What the model sees

One stable policy section states the exact Team role/name/id, explicit-delegation requirement, shared-cwd behavior, filesystem stale-version recovery, Bash/formatter/codegen risk, task/write-scope coordination, quiet versus waking delivery, no-retry mailbox rule, and the Lead's duty to wait before answering. The ten Team schemas from `spawn_teammate` through `team_task_update` appear only in Team member scopes.

#### Token effect

Fixed policy and schema cost on every Team member request. Tool calls add compact JSON roster, task, wait, or receipt results. Peer content is retained by the Team domain in the target's history.

#### KV Cache effect

Prefix-stable while the Team plugin generation, configuration, member role/name, and schemas remain unchanged. The per-member identity line differs across Agents. Tool results and peer messages append after the reusable request prefix.

## Known Limitations and Deferred Work

- **Prompt policy is coordination, not confinement** — it cannot stop Bash or external processes from writing overlapping files.
- **No autonomous team creation** — ordinary tasks do not trigger delegation unless the user explicitly requests it.
- **No Web controls** — browser roster, model-profile editing, and task-board presentation are outside this runtime package.
