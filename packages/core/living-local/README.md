# `@phoenix-ai/dsh-living-local`

English | [中文](README.zh.md)

Durable process-local implementation of `ctx.living`. It keeps creation manifests in an owner-private versioned JSON document while runtime provider attachments remain ephemeral.

## Behavior

Startup restores remembered manifests as offline creations. `remember()` writes the next complete catalog atomically before publishing it in memory. `attach()` validates that a provider can reach the manifest's target level, subscribes only to declared events, and reports the achieved level from real provider methods. Provider disposal changes connectivity but never deletes the manifest.

## Model Experience

Models do not call this package directly. With `@phoenix-ai/dsh-tool-living` mounted, remembered offline creations remain discoverable and can be reconnected by a generated provider or adapter.

## Limitations

This implementation is process-local: it does not itself transport events or actions across a network or process boundary. An out-of-process creation needs a separate adapter plugin that attaches a `LivingCreationProvider`.
