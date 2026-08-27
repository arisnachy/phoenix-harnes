# `@deepseek-ai/dsh-hardness`

English | [中文](README.zh.md)

Provider-neutral capability registry and Tool Atlas for PHOENIX HARDNESS.

The service records declared capability descriptors, required permissions, lifecycle status, verification evidence, and declarative modality routes. It does not grant permissions, store credentials, execute tools, or replace the tool and skill registries.

A route is selected only when the resolver returns a currently usable capability and its declared modalities intersect the requested preference. `unknown` means the need cannot be classified; `missing` means the need is known but no verified capability and modality can satisfy it. Required permissions are copied as declarations for a later broker, never granted here.

## Known Limitations and Deferred Work

The resolver and in-memory provider are the first foundation layer. Durable storage, source adapters, external acquisition, visual renderers, and generative UI are separate consumers and providers planned above this seam.
