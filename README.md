# PHOENIX

**Universal Adaptive AI Harness**

PHOENIX is a local-first, provider-agnostic runtime for resilient AI agents and workflows. It is designed so the identity of the system lives in the harness — memory, tools, missions, evidence and policy — rather than in any single model vendor.

> One harness. Any provider. Local when possible. Measurable evolution. Recoverable execution.

## What PHOENIX does now

- **Universal OpenAI-compatible provider fabric** for gateways, hosted APIs, self-hosted servers and local engines.
- **OrcaRouter free bootstrap preset** via `orcarouter/free`.
- **Ollama local route** and automatic `/models` discovery.
- **Universal provider manifest**: add an endpoint, API-key environment variable and model/discovery policy without editing PHOENIX core.
- **Capability-aware routing** with provider and model-level preferences/exclusions.
- **Fallback + circuit breaking** after retryable provider failures.
- **Append-only hash-chained execution ledger**.
- **Durable local memory** using JSONL with namespaces and episodic/semantic/checkpoint records.
- **Policy-gated Tool Registry** with `read`, `write`, `network` and `exec` risk classes.
- **Provider-agnostic Agent Runner** with multi-turn tool execution and correct tool-call history.
- **Local mission scheduler** for one-shot and recurring work.
- **Benchmark Arena** for repeatable provider/model comparisons.
- **Singularity Lab** for evidence-gated improvement proposals.
- **Adaptive Routing Policy** that can promote an approved challenger and roll back to the previous target.

## Evolution model

```text
Discover providers/models
        ↓
Conservative capability registry
        ↓
Route → Execute → Observe → Remember
        ↓
Benchmark Arena
        ↓
Singularity Lab
        ↓
Reject ───── or ───── Promotion proposal
                         ↓
                  explicit approval
                         ↓
                adaptive routing policy
                         ↓
                    rollbackable
```

PHOENIX uses **singularity** as an engineering direction, not as a claim of AGI or consciousness. Self-improvement is evidence-based, permission-gated, auditable and reversible.

See [`docs/SINGULARITY_RUNTIME.md`](docs/SINGULARITY_RUNTIME.md).

## Provider manifest

Copy `phoenix.providers.example.json` and customize it. Credentials are referenced by environment-variable name; keys do not belong in the manifest.

```json
{
  "providers": [
    {
      "id": "ollama",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "local": true,
      "discover": true,
      "capabilityPreset": "conservative"
    },
    {
      "id": "my-api",
      "baseUrl": "https://provider.example/v1",
      "apiKeyEnv": "MY_PROVIDER_API_KEY",
      "discover": true
    }
  ]
}
```

Unknown discovered models are deliberately conservative. `agentic-text` is an explicit opt-in for endpoints whose tools/JSON/reasoning support has been verified by the operator.

## Bootstrap

```ts
import {
  AdaptiveRoutingPolicy,
  PhoenixRuntime,
  bootstrapProviderManifest,
  loadPhoenixManifest,
} from '@phoenix/core';

const policy = new AdaptiveRoutingPolicy();
const phoenix = new PhoenixRuntime({ policy });
const manifest = await loadPhoenixManifest('phoenix.providers.json');
await bootstrapProviderManifest(phoenix, manifest);

const response = await phoenix.generate({
  messages: [{ role: 'user', content: 'Analyze this task.' }],
  preferences: { preferLocal: true, preferFree: true },
});
```

## Provider strategy

No provider has privileged access to PHOENIX core. The first universal transport targets OpenAI-compatible APIs because it covers many gateways and local runtimes. Native adapters can coexist whenever a provider exposes capabilities that cannot be represented faithfully through compatibility mode.

## Development

Requirements: Node.js 22+ and Corepack.

```bash
corepack enable
pnpm install
pnpm run verify
```

## Status

**Pre-alpha / evolutionary runtime.** Contracts and safety semantics are intentionally being hardened before adding unrestricted execution surfaces.

## License

GNU Affero General Public License v3.0. See `LICENSE`.
