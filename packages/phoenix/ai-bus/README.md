# PHOENIX AI Bus

`@deepseek-ai/dsh-phoenix-ai-bus` is the cost-lane layer for PHOENIX. It observes the native DeepSeek Harness LLM registry and classifies already-registered models as local-free, remote-free, or metered/unknown.

It does **not** grant model authority. PHOENIX Runtime's capability ladder remains the trust gate; the AI Bus only orders candidates that have already passed that gate.

## Free lanes

- **Ollama** is treated as local-free compute. PHOENIX never guesses which model is installed: `createOllamaProfile(model)` requires the operator or a later discovery surface to provide a real local model id.
- **OrcaRouter** is remote-free only when the model id is explicitly free, such as `orcarouter/free` or a `-free` model alias. Merely using the OrcaRouter gateway is never assumed to be free.
- Everything else is `metered-or-unknown` until an explicit policy says otherwise.

## OrcaRouter preset

The exported `ORCAROUTER_FREE_PROFILE` uses the OpenAI-compatible endpoint `https://api.orcarouter.ai/v1`, references `ORCAROUTER_API_KEY` without storing a secret, and advertises `orcarouter/free`. Its output cap is intentionally conservative relative to the upstream model limit.

## Ollama preset

```ts
import { createOllamaProfile } from '@deepseek-ai/dsh-phoenix-ai-bus'

const profile = createOllamaProfile('the-model-that-is-actually-installed')
```

The default endpoint is `http://127.0.0.1:11434/v1`. A different endpoint can be passed as the second argument.

## Design rule

Cost, capability, and authority are separate dimensions:

1. the DSH adapter registry says a route exists;
2. AI Bus says what cost lane it belongs to;
3. PHOENIX Capability Ladder says whether the model has authority for a role;
4. routing may then prefer the cheapest qualified candidate.

## Model Experience

### Cost-lane policy

#### What the model sees

Nothing directly. AI Bus registers no prompt text and no model-facing tool; it classifies routes that another PHOENIX consumer may choose after its own authority checks.

#### Token effect

Zero direct context tokens. A downstream route choice can change which provider/model accounts for a request, but AI Bus does not add request content.

#### KV Cache effect

AI Bus does not rewrite the request prefix. A route change may move a request to a different provider/model cache domain, so cache reuse across different selected models is not assumed.

## Known Limitations and Deferred Work

- **Free quota awareness** — cost lanes classify explicit model identities, not live account quota. `remote-free` means the configured route is explicitly free, not that quota is currently available.
- **Ollama discovery** — the package refuses to invent a local model id; automatic discovery of installed Ollama models is deferred to a dedicated provider-discovery surface.
- **Cost telemetry** — `metered-or-unknown` is intentionally conservative; live provider price accounting and per-request cost receipts are deferred.
