# @phoenix-ai/dsh-tool-agent-team

English | [中文](README.zh.md)

## Native execution receipts

`execution_steer` sends one bounded instruction to the same live Codex turn. Persist the input key before dispatch and retain it on retries: a reserved or uncertain input receipt is not resent automatically. A different instruction requires a different key. Other engines fail explicitly until their adapters support directing an active operation.

Lead-only `execution_run` selects one compatible engine using the saved Eclipse preference and the concrete resolved worker model. `execution_list` returns up to 32 recent receipt identities and states without starting work. `execution_recover` reconciles that same native operation after interruption; `execution_cancel` persists cancellation before interrupting it. Reuse the same idempotency key for the same task, and inspect uncertain receipts instead of submitting replacement work. These receipts establish execution state; artifact verification still determines whether the mission succeeded.

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

`freshProvider` and `forkProvider` select registered continuable-subagent transports. Under OpenAI Codex, `modelProfiles` supplies configured worker routes and `defaultModelProfile` selects the bounded execution route when `spawn_teammate.model_profile` is omitted. Outside OpenAI Codex, every teammate inherits the exact currently selected provider and model even when a profile is requested. Fénix Eclipse has two model roles: Kira's coordinator route covers planning, execution and rescue, while one configured subagent route covers every child identity. Kira retains her selected route for supervision and final verification; a worker's model route does not change its visible name or persona.

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

A bounded policy defines Kira's coordinator and subagent routes, task-sensitive reasoning, explicit effort precedence, minimal delegation, worker reuse, evidence checks and strategy review. Team tool schemas appear only in a Team member scope.

#### Token effect

Fixed policy and schema cost on every Team member request. Tool calls add compact JSON roster, task, wait, or receipt results. Peer content is retained by the Team domain in the target's history.

#### KV Cache effect

Prefix-stable while the Team plugin generation, configuration, member role/name, and schemas remain unchanged. The per-member identity line differs across Agents. Tool results and peer messages append after the reusable request prefix.



### Genuine directed Team conversation

#### What the model sees

`team_chat_reply_to_peer` records one model-authored Kira reply to a real delivered result/question/blocker/review. The bounded idempotent message is displayed under Kira's identity with the recipient's name and original message reference, with no extra child turn. Fictional, late and undelivered handoffs are rejected. New work must use `send_message` or `followup_task`; internal reporting does not require a fake shell action, while external operational claims remain evidence-gated.

#### Token effect

A directed response appends one bounded message to the Team transcript, without consuming a fake tool-execution turn or reawakening the child.

#### KV Cache effect

The tool policy remains stable; only the delivered reply is appended after the existing conversation prefix.

## Known Limitations and Deferred Work

- **Prompt policy is coordination, not confinement** — it cannot stop Bash or external processes from writing overlapping files.
- **No automatic fan-out** — the coordinator decides whether independent work warrants delegation and keeps the team bounded.
- **No Web controls** — browser roster, model-profile editing, and task-board presentation are outside this runtime package.

Kira responds to material teammate handoffs by name, evaluates the evidence and states the next decision before stopping or releasing work. The response belongs in the existing turn; finished workers are not awakened merely for acknowledgement.

Peer conversation advances through a decision and real action rather than repeating a report to the user. Workers must not stop at a plan; the Lead executes the next step or resumes a needed worker. Personality does not add idle turns or replace verification and delivery.
