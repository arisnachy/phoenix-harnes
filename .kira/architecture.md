# Architecture

DeepSeek Harness remains the upstream runtime. PHOENIX is an ordered profile, a deterministic router plugin, and an agent preset. The public CLI package is also the final PHOENIX bundle layer, so the shipped profile has no dependency on a fork-private package.

The host plane owns model routes and routing policy; the agent plane owns persona and tools. On `agent/inbox/claimed`, before prompt assembly, the router updates the public model-selection reference for new user tasks and agent relays. Tool results and notices retain the selected lane. Ollama is the default local lane. OrcaRouter exposes only `orcarouter/free`; there is no paid or failure-time provider fallback.
