# `@phoenix-ai/dsh-tool-living`

English | [中文](README.zh.md)

Model-facing consumer for Universal Living Creations. It installs one domain-neutral policy and tools for registering, inspecting, listing, reading, acting on, and verifying creations through `ctx.living`.

## Model Experience

Every model sees the same rule: anything Phoenix creates or materially modifies for the user is registered before delivery, regardless of domain or format. The model selects the strongest meaningful target level rather than forcing every artifact into an interactive shape. A static artifact may remain `static`; a live system must build and attach a provider or adapter and then pass `living_verify_creation` before completion.

`living_register_creation` accepts arbitrary `kind` text and self-described capabilities. `living_inspect_creation` exposes target versus achieved integration. `living_read_state` and `living_act` operate only through a connected provider. `living_verify_creation` fails while the achieved level remains below the declared target.

## Limitations

The tools do not manufacture a transport. For a target above `static`, generated code must attach a `LivingCreationProvider` directly or through an adapter appropriate to that creation's execution environment. Visual presentation alone does not satisfy the operational connection.
