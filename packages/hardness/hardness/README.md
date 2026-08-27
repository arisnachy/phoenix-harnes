# `@deepseek-ai/dsh-hardness`

Provider-neutral capability registry and Tool Atlas for PHOENIX HARDNESS.

The service records declared capability descriptors, required permissions, lifecycle status, and verification evidence. It does not grant permissions, store credentials, or replace the tool and skill registries.

## Known Limitations and Deferred Work

The resolver and in-memory provider are the first foundation layer. Durable storage, source adapters, external acquisition, visual renderers, and generative UI are separate consumers and providers planned above this seam.
