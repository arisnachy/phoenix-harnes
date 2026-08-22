# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

This downstream package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` with PHOENIX presentation when `DSH_CLIENT_BUILD_PROFILE` is `official`. The emblem is a responsive SVG phoenix that uses the existing amber/red design tokens, while the PHOENIX wordmark is rendered independently so the sidebar and hero can request different mark sizes without scaling one large composite asset.

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The package therefore works whether its row activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. The upstream npm/package identity remains unchanged so this downstream visual layer does not rename DeepSeek Harness implementation dependencies.

The web shell separately publishes `PHOENIX` as its document title and PWA application name and uses the same phoenix silhouette for `/favicon.svg`.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The package still has its upstream npm identity** — `@deepseek-ai/dsh-client-ui-brand-official` remains the internal package name for upstream compatibility; user-visible presentation is PHOENIX.
- **The PHOENIX mark uses the official profile seat** — non-`official` builds intentionally leave these slots empty for their own branding or shell fallback.
