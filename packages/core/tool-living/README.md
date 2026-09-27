# `@phoenix-ai/dsh-tool-living`

English | [中文](README.zh.md)

Model-facing consumer for Universal Living Creations. It installs one domain-neutral, fail-soft policy and tools for registering, provisioning connectors, inspecting, listing, reading, acting on, verifying, and explicitly forgetting creations through `ctx.living`.

## Model Experience

### Universal creation policy

#### What the model sees

The requested deliverable remains the mission. Phoenix connectivity is an optional enhancement unless the user explicitly requested it, previously opted in for that creation, or the connector is required for the requested functionality. The model must not register or install a connector merely because an artifact was created; when connectivity is useful and preference is unknown, it asks once. Connector setup is bounded to two connect/repair attempts and roughly ten seconds of foreground work, then fails soft: preserve any offline manifest, report degradation, and continue independent task work. A user request to skip or finish without the connector stops connector work for that turn.

#### Token effect

One bounded domain-neutral policy replaces domain-specific creation instructions. Its cost is fixed while the plugin is active and does not grow with the number of remembered creations.

#### KV Cache effect

The policy text is prefix-stable while the plugin version and registration scope are unchanged. Creation-specific state is queried through tools instead of being appended to every request.

### Living tools

#### What the model sees

The model receives schemas for registering, inspecting, listing, reading, acting on, verifying, obtaining connector kits, and explicitly forgetting creations. `living_verify_creation` is used only when Phoenix connectivity is an explicit acceptance criterion, not as a universal completion gate. When a connector is used, the model exposes only the smallest meaningful state/actions/events, keeps telemetry bounded, retains enough manifest resources to reconnect later, and never exposes or commits the bearer token. Background agents remain optional and require user approval; connectivity never implies background workers.

#### Token effect

Tool schema cost is fixed per visible tool set. Creation manifests, telemetry, and errors enter context only when the model invokes the corresponding inspection/read/verification tools.

#### KV Cache effect

Schemas remain cache-stable while visibility and definitions are unchanged. Per-creation updates affect tool results at the history tail rather than rewriting the reusable prompt prefix.

## Known Limitations and Deferred Work

- The generated connector kit is intentionally transport-light and owner-local. Public browser bundles must not contain the bearer token; browser-facing products should keep the Phoenix connector in a server-side process/sidecar or use another secure provider implementation.
