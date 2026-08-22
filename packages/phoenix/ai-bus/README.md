# PHOENIX AI Bus

`@deepseek-ai/dsh-phoenix-ai-bus` is the cost-lane layer for PHOENIX. It observes the native DeepSeek Harness LLM registry and classifies already-registered models as local-free, remote-free, or metered/unknown.

It does **not** grant model authority. PHOENIX Runtime's capability ladder remains the trust gate; the AI Bus only orders candidates that have already passed that gate.

## Free lanes

- **Ollama** is treated as local-free compute. PHOENIX never guesses which model is installed: `createOllamaProfile(model)` requires the operator or a later discovery surface to provide a real local model id.
- **OrcaRouter** is remote-free only when the model id is explicitly free, such as `orcarouter/free` or a `-free` model alias. Merely using the OrcaRouter gateway is never assumed to be free.
- Everything else is `metered-or-unknown` until an explicit policy says otherwise.

## OrcaRouter preset

The exported `ORCAROUTER_FREE_PROFILE` uses the OpenAI-compatible endpoint `https://api.orcarouter.ai/v1`, references `ORCAROUTER_API_KEY` without storing a secret, and advertises `orcarouter/free`. Its output cap is intentionally conservative even though the underlying free DeepSeek V4 models expose a much larger maximum.

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
