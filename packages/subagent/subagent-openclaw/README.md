# OpenClaw Gateway client

English | [中文](README.zh.md)

`@phoenix-ai/dsh-subagent-openclaw` is a portable TypeScript client for the public OpenClaw Gateway WebSocket protocol. It waits for the documented `connect.challenge`, sends a bounded `connect` request with only `operator.read` and `operator.write` by default, and exposes credential-free health, capability, session, agent, event, and read-only automation results.

The package uses the documented wire protocol because the public `@openclaw/gateway-client` package is not part of this workspace and a separate host manager owns the official Gateway runtime. It does not import OpenClaw's private SDK or install/start OpenClaw.

```ts
import { OpenClawGatewayClient } from '@phoenix-ai/dsh-subagent-openclaw'

const token = process.env.OPENCLAW_GATEWAY_TOKEN
const gateway = new OpenClawGatewayClient({
  url: 'ws://127.0.0.1:18789',
  credentials: token === undefined ? {} : { token },
})

try {
  const capabilities = await gateway.capabilities()
  const result = await gateway.executeAgent({
    message: 'Run the approved local operation.',
    idempotencyKey: 'phoenix-execution-0001',
  })
  console.log(capabilities.protocol, result)
} finally {
  await gateway.dispose()
}
```

Plain `ws:` is accepted only for loopback hosts (`localhost`, `127.0.0.1`, and `::1`). Encrypted `wss:` endpoints are accepted for a separately secured deployment. Credentials remain in the host-owned client instance; they are omitted from handshake results, RPC results, error details, and event payloads. This client never pairs channels, logs in a channel, installs skills, edits configuration, or exposes write methods for cron, skills, or channels.

`executeAgent` and `executeSession` require a caller-owned native idempotency key. `request` enforces UTF-8 frame bounds, per-request timeouts, `AbortSignal` cancellation, and rejection after disposal. `onEventGap` reports a missing Gateway sequence; `reconcile()` reads fresh `health` and `sessions.list` state so the owning Phoenix runtime can decide whether to resume or surface an uncertain execution.

The package also exports the `subagent-openclaw` Cordis plugin and `OpenClawExecutionAdapter`. Configure an explicit `url`, `agentId`, `provider`, and `model` (plus an optional host-only `tokenRef` and `sessionKey`) to register the `openclaw` Agent Teams engine. The engine remains registered but reports disconnected until that configuration and the Gateway route are verified. Before dispatch it compares the Phoenix snapshot with the exact model reported by `agents.list` and the matching `sessions.list` row. It does not send an invented model override to `agent`; `agent.wait` and the session transcript establish completion, while recovery only waits on the persisted native binding.

The managed runtime recognizes both model-scoped `agents.defaults.models[modelRef].agentRuntime.id` and provider-scoped `models.providers.openai.agentRuntime.id`; an explicit model override wins. A configured `plugins.allow` must include `codex`. Neither a configuration-supplied attestation nor a Gateway connection substitutes for Host policy proof. The bundled plugin remains unavailable until a trusted Host authority supplies the managed route, private client factory and current session policy evidence. Policy is checked before reservation, dispatch and recovery against the owning Phoenix workspace and sandbox, falling back to read-only authority. A changed tool policy or unverifiable native session blocks execution. The production Host authority and a real model-backed Gateway acceptance test remain pending. Transport authentication alone does not authorize a task; uncorrelated session history is not returned as run output.

## Model Experience

### Native execution results

#### What the model sees

The transport adds no tool schema or system instruction. The owning Team execution consumer supplies the authorized task, frozen route and bounded recalled reference context. It receives a structured `team/execution` completion, failure or uncertainty result tied to the saved native binding; raw Gateway history and credentials are excluded.

#### Token effect

A native agent task uses its own model context. Phoenix includes only the bounded task, selected reference material and correlated result; read-only Gateway discovery calls do not generate model tokens.

#### KV Cache effect

Task results append to the owning conversation. The transport does not rewrite the reusable prompt prefix or claim a native cache hit.

## Known Limitations and Deferred Work

- The package currently does not provision or supervise an OpenClaw process, persist device identity, automatically reconnect, or claim compatibility with a particular Gateway release. A real official-Gateway check remains a deployment concern and must use a separately configured local Gateway; the package tests use a local `ws` server and do not establish production readiness.

- Model, tool, channel, pairing, approval, and credential policy remain Gateway and Phoenix responsibilities. This transport does not broaden scopes based on model-provided data.

- The transport does not choose a provider or model. `models.list` is only a catalog and is never treated as proof that an agent uses a route. The adapter fails closed unless the configured native agent and session both report the exact provider/model selected by Phoenix. Channel pairing, login, and delivery setup remain explicit deployment actions outside this package.