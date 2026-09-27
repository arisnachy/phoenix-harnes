# `@phoenix-ai/dsh-tool-living`

English | [中文](README.zh.md)

Model-facing consumer for Universal Living Creations. It installs one domain-neutral policy and tools for registering, provisioning connectors, inspecting, listing, reading, acting on, verifying, and explicitly forgetting creations through `ctx.living`.

## Model Experience

### Universal creation policy

#### What the model sees

Whenever Phoenix creates or materially modifies a user-facing artifact or runnable system, the model must register it before delivery regardless of domain or format. Every Phoenix-created output receives a connector contract; mutable creations target live control rather than silently downgrading to a static artifact. Background workers are optional and require explicit user consent.

#### Token effect

One bounded domain-neutral policy replaces domain-specific creation instructions. Its cost is fixed while the plugin is active and does not grow with the number of remembered creations.

#### KV Cache effect

The policy text is prefix-stable while the plugin version and registration scope are unchanged. Creation-specific state is queried through tools instead of being appended to every request.

### Living tools

#### What the model sees

The model receives schemas for registering, inspecting, listing, reading, acting on, verifying, obtaining connector kits, and explicitly forgetting creations. `living_register_creation` accepts arbitrary `kind` text and self-described capabilities, provisions a per-creation control identity, and keeps telemetry/error surfaces tied to that durable identity. `living_verify_creation` refuses completion while the achieved integration remains below the declared target.

#### Token effect

Tool schema cost is fixed per visible tool set. Creation manifests, telemetry, and errors enter context only when the model invokes the corresponding inspection/read/verification tools.

#### KV Cache effect

Schemas remain cache-stable while visibility and definitions are unchanged. Per-creation updates affect tool results at the history tail rather than rewriting the reusable prompt prefix.

## Known Limitations and Deferred Work

- The generated connector kit is intentionally transport-light and owner-local. Public browser bundles must not contain the bearer token; browser-facing products should keep the Phoenix connector in a server-side process/sidecar or use another secure provider implementation.
