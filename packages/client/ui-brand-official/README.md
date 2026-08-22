# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

This downstream package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` with PHOENIX presentation in every Web build profile. The emblem is a responsive SVG phoenix that uses the existing amber/red design tokens, while the PHOENIX wordmark is rendered independently so the sidebar and hero can request different mark sizes without scaling one large composite asset.

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The package therefore works whether its row activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. The upstream npm/package identity remains unchanged so this downstream visual layer does not rename DeepSeek Harness implementation dependencies.

The web shell separately publishes `PHOENIX` as its default document title and PWA application name and uses the same phoenix silhouette for `/favicon.svg`; the official artifact profile also pins `DSH_CLIENT_TITLE` to `PHOENIX` so release builds cannot silently restore the upstream title.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The package still has its upstream npm identity** — `@deepseek-ai/dsh-client-ui-brand-official` remains the internal package name for upstream compatibility; user-visible presentation is PHOENIX.
- **Runtime artwork is deliberately simplified** — the shipped SVG preserves the approved phoenix identity while remaining legible at 24–34 px; richer cinematic artwork remains a promotional asset rather than a small UI mark.
