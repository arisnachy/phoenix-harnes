# PHOENIX model router

English | [中文](phoenix-routing.zh.md)

The CLI-owned router selects one of two already registered Harness model routes for each new user or agent-relay task. It observes the public inbox-claim event, which occurs before prompt assembly. It does not call providers, discover models, manage credentials, retry through another provider, or modify the Agent loop.

The policy is deterministic and composition-visible:

1. `[phoenix:local]` forces the local route.
2. `[phoenix:free]` forces the free external route.
3. Text at or above `externalMinChars` uses the free route.
4. Text matching at least `externalSignalThreshold` distinct configured signals uses the free route.
5. Everything else uses the local route.

Only new user messages and agent relays are classified. Tool results and injected notices retain the current turn's route. Prefixes remain in the model-visible request so routing never silently rewrites user content.

## Model Experience

### Task route selection

#### What the model sees

The router adds no message or prompt section. The selected model sees the ordinary task and a persona whose `{{model}}` variable names that same route. A supplied `[phoenix:local]` or `[phoenix:free]` prefix remains visible because the router never rewrites user content.

#### Token effect

Zero direct tokens. The policy inspects already-present task text and writes only request-routing configuration. An explicit prefix costs the tokens the user supplied.

#### KV Cache effect

A local-to-free or free-to-local decision changes provider/model and therefore changes cache domain. Repeated tasks on the same lane receive no router-added dynamic prefix, so this package does not invalidate that lane's reusable prompt prefix.

## Known Limitations and Deferred Work

- Classification uses literal text rules, not a semantic model. Operators should tune the visible signal list and threshold for their workload.
- A forced prefix is not removed from the prompt.
- Provider outage recovery is left to each route's own retry policy. The router does not switch providers after a failed request.
- The local model must already be installed and Ollama must be running; the external lane needs an `ORCAROUTER_API_KEY` credential.
- The shipped PHOENIX bundle binds the free route only to `orcarouter/free`; the router has no paid fallback and never selects `orcarouter/auto`.
