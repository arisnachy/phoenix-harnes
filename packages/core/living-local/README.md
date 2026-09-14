# `@phoenix-ai/dsh-living-local`

English | [中文](README.zh.md)

Durable process-local implementation of `ctx.living`. It keeps creation manifests in an owner-private versioned JSON document while runtime provider attachments remain ephemeral.

## Behavior

Startup restores remembered manifests as offline creations. Durable `remember()` and `forget()` mutations run through one serialized commit queue, so concurrent updates cannot overwrite one another. Each mutation atomically writes the next complete catalog before publishing it in memory; a failed write leaves both the in-memory manifest set and any attached provider unchanged.

`attach()` validates that a provider can reach the manifest's target level, subscribes only to events declared by the current committed manifest, and reports the achieved level from real provider methods. Replacing a manifest while a provider is attached is admitted only when that provider satisfies the new contract; if a provider changes during the durable write and no longer satisfies the committed manifest, it is detached rather than left falsely connected. Provider disposal changes connectivity but never deletes the manifest.

## Model Experience

Models do not call this package directly. With `@phoenix-ai/dsh-tool-living` mounted, remembered offline creations remain discoverable and can be reconnected by a generated provider or adapter.

## Limitations

This implementation is process-local: it does not itself transport events or actions across a network or process boundary. An out-of-process creation needs a separate adapter plugin that attaches a `LivingCreationProvider`.
