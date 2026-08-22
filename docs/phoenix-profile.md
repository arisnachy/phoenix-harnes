# PHOENIX profile

English | [中文](phoenix-profile.zh.md)

This built-in profile layer composes with the shipped base and web bundles; it does not fork the Agent loop or duplicate provider adapters. Its patch and router ship inside the CLI package, so the public CLI has no dependency on a private downstream package.

It declares two routes through `@deepseek-ai/dsh-llm-pi-ai`:

- `phoenix-local/qwen3:8b` at the local Ollama OpenAI-compatible endpoint.
- `phoenix-free/orcarouter/free` at OrcaRouter, authenticated by `ORCAROUTER_API_KEY`.

It then mounts `@deepseek-ai/dsh/phoenix-router` from the same CLI package and selects the shipped `phoenix` agent preset. There is deliberately no `orcarouter/auto` route and no failure-time provider fallback.

## Model Experience

### PHOENIX route composition

#### What the model sees

The selected model receives the PHOENIX preset persona with its own model id substituted into `{{model}}`. Routine tasks reach `qwen3:8b`; promoted tasks reach `orcarouter/free`. `[phoenix:local]` and `[phoenix:free]` remain in user text when supplied.

#### Token effect

The bundle adds only the PHOENIX persona text already owned by the selected preset. Routing metadata adds no message. A forced prefix costs only the tokens already present in the user's message.

#### KV Cache effect

Switching lanes necessarily selects another provider/model cache. Within one lane, the bundle contributes stable persona text and no per-request routing suffix, so it does not introduce additional prefix churn.

## Known Limitations and Deferred Work

- Before first use, install Ollama, run `ollama pull qwen3:8b`, and keep the local service listening on `127.0.0.1:11434`.
- The free lane requires `ORCAROUTER_API_KEY` and remains subject to OrcaRouter's available free quota and model availability.
- This foundation does not yet implement PHOENIX memory, receipts, Forge Chamber, Evolution Mesh, HealthIA packs, or semantic routing.
- The shipped context and output declarations are conservative adapter metadata, not a guarantee that every dynamically selected upstream free model exposes that full capacity.
