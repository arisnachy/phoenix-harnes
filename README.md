# PHOENIX

**Universal Adaptive AI Harness**

PHOENIX is a local-first, provider-agnostic runtime for resilient AI agents and workflows. The system identity lives in the harness — memory, tools, missions, evidence, token economy and policy — rather than in any single model vendor.

> One harness. Any provider. Spend intelligence only where it earns its keep.

## What PHOENIX does now

- **Universal OpenAI-compatible provider fabric** for gateways, hosted APIs, self-hosted servers and local engines.
- **OrcaRouter free bootstrap** and **Ollama local discovery**.
- **Subscription lanes** for locally installed/authenticated Codex CLI and Claude Code CLI; PHOENIX never copies their authentication material.
- **Universal provider manifest**: local/free/subscription/API providers coexist without editing core.
- **Capability-aware routing** plus provider/model preferences, exclusions, fallback and circuit breaking.
- **Token Governor** that classifies task complexity, applies budgets and chooses local/free/subscription/metered lanes.
- **Context Compiler** that ranks relevance, deduplicates content and reuses unchanged context fingerprints after Rebirth.
- **Bounded agent history** that digests old turns while preserving the newest tool-call transaction.
- **Opt-in exact result cache** and **TokenUsageBook** for actual/cached/avoided token accounting.
- **Experience Compiler** that crystallizes repeated successful work into compact verified skills.
- **Rebirth durable missions** with provider session IDs, context fingerprints, next action, token state, mission fork and resume.
- **Durable local memory** using JSONL with namespaces and episodic/semantic/checkpoint records.
- **Policy-gated Tool Registry** with `read`, `write`, `network` and `exec` risk classes.
- **Provider-agnostic Agent Runner** with multi-turn tool execution and correct tool-call history.
- **Local mission scheduler** for one-shot and recurring work.
- **Benchmark Arena** for quality, success, latency, fresh/cached input tokens, output tokens and reported cost.
- **Singularity Lab + Adaptive Routing Policy** for evidence-gated promotion and rollback.
- **Append-only hash-chained execution ledger** for auditable decisions.

## The efficiency thesis

Most long-running harnesses repeatedly pay for context they already saw and reasoning they already learned. PHOENIX attacks that directly:

```text
mission
  ↓
complexity + token budget
  ↓
local/free/subscription/metered lane
  ↓
relevant changed context only
  ↓
execute + measure actual usage
  ↓
checkpoint provider session + context fingerprints
  ↓
verified success
  ↓
crystallize reusable skill
  ↓
next similar mission starts cheaper
```

The Benchmark Arena does not call a configuration "better" merely because it is cheaper. `compareEfficiency()` requires quality/success to remain materially non-worse and fresh input-token consumption to be lower before `dominates=true`.

See [`docs/EFFICIENCY_RUNTIME.md`](docs/EFFICIENCY_RUNTIME.md) and [`docs/SINGULARITY_RUNTIME.md`](docs/SINGULARITY_RUNTIME.md).

## Provider manifest

Copy `phoenix.providers.example.json` to `phoenix.providers.json`. The real local manifest is ignored by Git. API credentials are referenced only by environment-variable name.

```json
{
  "providers": [
    { "id": "codex-cli", "kind": "codex-cli", "models": ["default"] },
    { "id": "claude-code-cli", "kind": "claude-code-cli", "models": ["default"] },
    {
      "id": "ollama",
      "kind": "openai-compatible",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "local": true,
      "discover": true
    },
    {
      "id": "my-api",
      "kind": "openai-compatible",
      "baseUrl": "https://provider.example/v1",
      "apiKeyEnv": "MY_PROVIDER_API_KEY",
      "discover": true
    }
  ]
}
```

### Codex / ChatGPT plan boundary

The `codex-cli` lane launches the user's official local Codex CLI in `read-only` sandbox mode and parses its JSONL response/usage/session ID. Authentication remains inside Codex. A ChatGPT subscription is **not** converted into an OpenAI API balance and PHOENIX does not extract OAuth tokens, cookies or credentials.

### Claude Code boundary

The `claude-code-cli` lane launches the user's authenticated Claude Code CLI with `--permission-mode plan`. PHOENIX captures the returned session/usage telemetry but retains execution authority in its own Tool Registry.

## Bootstrap

```ts
import {
  AdaptiveRoutingPolicy,
  ExactResultCache,
  PhoenixRuntime,
  TokenGovernor,
  bootstrapProviderManifest,
  loadPhoenixManifest,
} from '@phoenix/core';

const manifest = await loadPhoenixManifest('phoenix.providers.json');
const policy = new AdaptiveRoutingPolicy();
const governor = new TokenGovernor({
  lanes: [
    { id: 'local', kind: 'local', providerId: 'ollama', maxComplexity: 'routine' },
    { id: 'codex-plan', kind: 'subscription', providerId: 'codex-cli', maxComplexity: 'critical' },
    { id: 'claude-plan', kind: 'subscription', providerId: 'claude-code-cli', maxComplexity: 'critical' },
  ],
});

const phoenix = new PhoenixRuntime({ policy, governor, resultCache: new ExactResultCache() });
await bootstrapProviderManifest(phoenix, manifest);

const response = await phoenix.generate({
  messages: [{ role: 'user', content: 'Analyze this task.' }],
  preferences: { preferLocal: true, preferFree: true },
});
```

## Evolution model

```text
Discover → Route → Execute → Measure → Remember
                     ↓
                Benchmark Arena
                     ↓
                Singularity Lab
               ↙             ↘
            reject        proposal
                              ↓
                         approval
                              ↓
                       canary / route
                              ↓
                           rollback
```

PHOENIX uses **singularity** as an engineering direction, not as a claim of AGI or consciousness. Self-improvement is evidence-based, permission-gated, auditable and reversible.

## Provider strategy

No provider has privileged access to PHOENIX core. Unknown discovered models fail closed on unverified capabilities. Native adapters can coexist whenever a provider exposes capabilities that cannot be represented faithfully through compatibility mode.

## Development

Requirements: Node.js 22+ and Corepack.

```bash
corepack enable
pnpm install
pnpm run verify
```

## Status

**Pre-alpha / evolutionary runtime.** PHOENIX is now explicitly instrumented to test whether its routing/context/experience strategies can match or exceed raw vendor-harness quality with lower fresh-token consumption. Global superiority is not assumed; it must be demonstrated on reproducible live workloads.

## License

GNU Affero General Public License v3.0. See `LICENSE`.
