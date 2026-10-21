# @phoenix-ai/dsh-agent-default-model

English | [中文](README.zh.md)

The deployment default used when an entry point creates an Agent that has no session-local model selection. `AgentDefaultModelConfig` provides `ctx.agentDefaultModel`; direct entry points such as `dsh --profile headless` and Host-backed entry points such as ApiProxy read the same service instead of owning parallel provider/model defaults.

The plugin config requires `{ provider, model }`. That composition entry is the base of the `agent-default-model` Settings section; a mounted settings provider layers the user's choice over it and changes are visible on the next `currentSelection()` read. `reasoningEffort` belongs to the Settings section but deliberately not to plugin config: a complete saved selection can clear an effort when the next selected model has none, while a composition value would be inherited again.

- `ctx.agentDefaultModel.currentSelection()` returns a detached `{ provider, model, reasoningEffort? }` selection for a newly created Agent.
- `ctx.agentDefaultModel.saveSelection(selection)` saves the complete user selection. Without a settings provider it is a no-op and the composition entry remains current.

Fénix Eclipse has three independently configurable routes in the `eclipse-routing` section: `planner` for Kira's initial strategy and subsequent evidence-based reviews, `coordinator` for Kira's execution, and `subagent` for delegated teammates. New routes must use `openai-codex`; the optional `reasoningEffort` remains provider-owned and is validated against the live model catalog in the editor. `escalationSensitivity` supports `adaptive` (default), `quality` (early review of complex tool failures), and `economy` (only explicit strategy requests or Team blockers). There is no numeric limit on strategy consultations: the runtime permits another one after a new tool result, provider retry, or distinct Team blocker and suppresses repeats of an unchanged outcome. Older planner-only profiles without an `escalationSensitivity` setting migrate to the coordinator route without rewriting their stored settings. In Fénix Eclipse, a short greeting (including a direct address such as `hola Kira`) or a contextual social opener bypasses planning and uses GPT-6 Luna at Max effort, even when a coordinator role is pinned to Sol; manual model pins still govern non-conversational operational tasks. This is an intentional conversational quality preference and may increase latency/cost versus Low effort.

The service does not validate catalog membership. A provider route may serve an unadvertised model, and the consumer that actually opens a model request owns availability diagnostics.

## Model Experience

Indirectly, through the provider/model selection supplied to an entry point; request assembly and adapters own the model-visible request.

#### KV Cache effect

Changing the default affects only Agents that subsequently resolve from it. An existing session whose request log already names a selection keeps that selection, so this service does not invalidate its established prefix.

## Known Limitations and Deferred Work

- The service owns one process-wide default; per-session selection remains the entry point's responsibility.
- Without a settings provider, `saveSelection()` cannot retain a selection for a later Agent.
