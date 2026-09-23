# `@phoenix-ai/dsh-tool-living`

English | [中文](README.zh.md)

Model-facing consumer for Universal Living Creations. It installs one domain-neutral policy and tools for registering, provisioning connectors, inspecting, listing, reading, acting on, verifying, and explicitly forgetting creations through `ctx.living`.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope receives the standing universal-living policy below; tool visibility changes do not remove the independently registered prompt section.

##### Universal living creation policy

```markdown
Universal Living Creation policy: the user's requested deliverable is the mission; Phoenix connectivity is an optional enhancement unless the user explicitly requested it, previously opted in for that creation, or the connector is itself required for the requested functionality. Do not register or install a connector merely because an artifact was created. When connectivity is desired and preference is unknown, ask once rather than silently enabling it. Connector setup is fail-soft: spend at most two bounded connect/repair attempts and roughly ten seconds of foreground wall time per creation; on transport, contract, or authorization failure, preserve any offline manifest, mark/report the connection as degraded, and continue every independent task step. Never let connector repair consume the main task, tests, or final delivery. If the user says to skip, forget, ignore, or finish without the connector, stop connector work immediately and continue the task; do not retry it again in the same turn. Do not call living_verify_creation as a universal completion gate: use it only when Phoenix connectivity is an explicit acceptance criterion. Prefer the generated JavaScript/Python connector kit or native Living tools for the control handshake; do not synthesize Invoke-WebRequest or other interactive PowerShell loops for /connect. Never expose or commit the bearer token. Keep agents optional and user-approved; connectivity never implies background workers. When a connector is used, expose only the smallest meaningful state/actions/events, keep telemetry bounded, and retain enough resources in the manifest to reconnect later.
```

#### Token effect

Fixed guidance cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and policy text are unchanged. Plugin activation, disposal, or policy changes may invalidate reuse from this section.

### Tool schemas

#### What the model sees

The generated [`living_register_creation`, `living_get_connector_kit`, `living_inspect_creation`, `living_list_creations`, `living_read_state`, `living_act`, `living_verify_creation`, and `living_forget_creation` schemas](../../../docs/tool-catalog.md#phoenix-aidsh-tool-living) while this tool set is visible.

#### Token effect

Fixed schema cost on requests where the Living tools are visible; returned manifests, state, connector descriptors, and action results are data-dependent.

#### KV Cache effect

Prefix-stable while definitions and visibility are unchanged. Tool lifecycle or scoped restrictions may invalidate reuse from the first changed schema token; tool results append after the reusable prefix.

## Known Limitations and Deferred Work

- The generated connector kit is intentionally transport-light and owner-local. Public browser bundles must not contain the bearer token; browser-facing products should keep the Phoenix connector in a server-side process or sidecar, or use another secure provider implementation.
