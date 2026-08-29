# `@phoenix-ai/dsh-hardness`

English | [中文](README.zh.md)

Provider-neutral capability registry and Tool Atlas for PHOENIX HARDNESS.

The service records declared capability descriptors, required permissions, lifecycle status, verification evidence, and declarative modality routes. It does not grant permissions, store credentials, execute tools, or replace the tool and skill registries.

A route is selected only when the resolver returns a currently usable capability and its declared modalities intersect the requested preference. `unknown` means the need cannot be classified; `missing` means the need is known but no verified capability and modality can satisfy it. Required permissions are copied as declarations for a later broker, never granted here.

`CapabilitySurface` projects a route into stable preview data (`id`, inputs, outputs, modality, verification, and declared permissions). It is JSON-serializable and contains no callback, credential, sandbox handle, or workspace mutation. Missing and unknown resolutions produce no surface.

## Model Experience

### Capability Atlas metadata

#### What the model sees

Consumers may expose declarative HARDNESS fields such as `capabilityId`, modality, verification state, inputs, outputs, and declared permissions; the registry itself exposes no credential or executable handle.

##### Operating protocol

```markdown
The shared HARDNESS lifecycle is inspect → resolve → plan → approve → execute → verify → present → audit. Evaluation is serializable guidance only; unresolved, denied, failed, or unverified work remains blocked.
```

#### Token effect

Only consumers that serialize selected capability metadata or install the protocol guide add model tokens; this registry does not mount a prompt section by itself.

#### KV Cache effect

Stable descriptors remain cache-friendly until capability metadata, routing, or verification state changes.

## Known Limitations and Deferred Work

- The resolver and in-memory provider are the first foundation layer. Durable storage, source adapters, external acquisition, visual renderers, and generative UI are separate consumers and providers planned above this seam.
