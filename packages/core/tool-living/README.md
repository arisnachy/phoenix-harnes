# `@phoenix-ai/dsh-tool-living`

English | [中文](README.zh.md)

Model-facing consumer for Universal Living Creations. It installs one domain-neutral policy and tools for registering, provisioning connectors, inspecting, listing, reading, acting on, verifying, and explicitly forgetting creations through `ctx.living`.

## Model Experience

### Universal living creation controls

#### What the model sees

Every model sees the same standing rule: whenever Phoenix creates or materially modifies a user-facing artifact or runnable system, it registers that creation before delivery regardless of domain or format. Mutable applications, sites, services, simulations, and operational dashboards normally target `controllable`; genuinely non-live artifacts can remain `static`.

`living_register_creation` accepts arbitrary `kind` text and self-described capabilities. For every non-static target it automatically provisions one per-creation control link while preserving that identity across later updates. `living_get_connector_kit` returns secret-safe JavaScript/Node and Python sidecar modules plus the runtime descriptor; generated source reads the bearer from environment rather than embedding it.

`living_inspect_creation` exposes target versus achieved integration. `living_read_state` and `living_act` operate only through a connected provider. `living_verify_creation` fails while the achieved level remains below the declared target, so Phoenix cannot claim a live app is finished merely because its files or preview exist. `living_forget_creation` removes the durable identity only when the user explicitly wants Phoenix to stop remembering the creation or it has been permanently deleted.

#### Token effect

The standing rule and tool schemas add a bounded fixed prompt cost while the consumer is mounted. Tool results add only the creation metadata, state, verification, connector-kit metadata, or action result requested for that call.

#### KV Cache effect

The standing policy and stable tool schemas can remain in the reusable request prefix. Creation state and action results are dynamic append-only tool results and do not rewrite earlier cached context.

## Known Limitations and Deferred Work

- The generated connector kit is intentionally transport-light and owner-local.
- Public browser bundles must not contain the bearer token; browser-facing products should keep the Phoenix connector in a server-side process/sidecar or use another secure provider implementation.
