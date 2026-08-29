# @phoenix-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

This downstream package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` with PHOENIX presentation in every Web build profile. The emblem is a responsive SVG phoenix, while the independent PHOENIX wordmark lets the sidebar and Hero request different mark sizes.

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The package therefore works whether its row activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. The upstream package identity remains unchanged for runtime compatibility.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The package retains its upstream npm identity** — `@phoenix-ai/dsh-client-ui-brand-official` remains the internal package name; the user-visible product identity is PHOENIX.
- **The browser title is independent** — the Web shell and official artifact profile also select PHOENIX outside the slot system.
