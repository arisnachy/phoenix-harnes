# PHOENIX

**Universal Adaptive AI Harness**

PHOENIX is a provider-agnostic runtime for building resilient AI agents and workflows without locking the application to one model vendor, API protocol, cloud, or local inference engine.

> One harness. Any provider. Measurable routing. Recoverable execution.

## Genesis principles

1. **Provider independence** — provider details terminate at adapters; the core operates on PHOENIX contracts.
2. **Capability-aware routing** — route by tools, reasoning, modality, context, cost, latency, privacy, health and user policy instead of model-name folklore.
3. **Free/local first when requested** — OrcaRouter or local Ollama may be preferred, but neither becomes a single point of failure.
4. **Traceable decisions** — routing and execution outcomes are written to an append-only ledger.
5. **Gated evolution** — measurements may propose routing-policy improvements; evolution never silently rewrites production behavior.

## Genesis architecture

```text
Application / Agent / Workflow
          |
          v
+-----------------------------+
|       PHOENIX Runtime       |
|-----------------------------|
| universal request contract  |
| capability router           |
| circuit breaking + fallback |
| execution ledger            |
| evolution observations      |
+-----------------------------+
          |
          v
+-----------------------------+
|       Provider Fabric       |
| OpenAI-compatible | native  |
+-----------------------------+
   |       |       |       |
 Orca   Ollama   OpenAI   custom...
 Router           APIs
```

## Provider strategy

The first provider fabric supports **OpenAI-compatible endpoints**, covering hosted APIs, gateways, self-hosted servers and local runtimes. Native adapters can coexist whenever a provider exposes capabilities that cannot be represented faithfully through a compatibility layer.

Initial presets:

- **OrcaRouter** — optional free bootstrap route via `orcarouter/free`; requires `ORCAROUTER_API_KEY`.
- **Ollama** — local endpoint at `http://127.0.0.1:11434/v1`.
- **Custom OpenAI-compatible provider** — arbitrary base URL, API-key environment variable and model catalog.

No provider has privileged access to the PHOENIX core.

## Development

Requirements: Node.js 22+ and Corepack.

```bash
corepack enable
pnpm install
pnpm run verify
```

## Status

**Genesis / pre-alpha.** The first milestone is hardening universal provider contracts, routing and failure semantics before expanding the agent surface.

## License

GNU Affero General Public License v3.0. See `LICENSE`.
