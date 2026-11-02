# Agent Note: attachment projection, stable updates, secret vault, and quota continuity

Status: implemented

English | [中文](2026-08-31-attachment-update-vault-quota.zh.md)

## Problem

The model received attachment metadata without useful content for non-image files, the local updater ignored the moving `stable` release branch, secrets entered through the chat could be exposed to model-visible history, and the Codex quota meter disappeared when the Settings model selector remounted.

## Decision

The attachment capability projects bounded UTF-8 text, uncompressed PDF text, and Open XML document text into the model request while retaining images as image parts and opaque binaries as safe metadata or printable text. The updater fetches the configured release branch, defaults to `stable`, and only mutates `main` or `stable`; development branches inspect and report without changing user files. `secret-vault` adds a human-only `/secret` command that writes through the existing credentials provider, excludes the value from command results and session events, and exposes only configured status to the model. The Codex quota component caches valid telemetry by the stable page connection so selector and Settings remounts render the last known 5h/7d data immediately while a fresh authorization read runs.

## Alternatives considered

**Send every file as raw text.** Rejected because binary data is not reliably meaningful to a text model and can create unbounded prompts; recognized formats receive bounded projections and other files remain metadata-only unless a safe parser exists.

**Use the manifest commit as the only update target.** Rejected because a release manifest can lag the moving `stable` branch; the updater validates the manifest and then reads the configured remote release ref, while refusing unsafe branch mutation.

**Put secret values into the conversation with redaction afterward.** Rejected because the value would already cross the model and transcript boundary; the vault accepts it as a human-only command and resolves it through credentials without returning the value.

**Keep quota only in component state.** Rejected because the Settings outlet is remounted by model-menu interactions; a connection-scoped cache preserves continuity without sharing data across page connections.

## Consequences

Common text, PDF, and Office attachments are model-readable with a byte bound, while unsupported binary formats still require a domain parser or a user-provided textual export. Stable updates become discoverable from a dirty or development checkout but automatic mutation remains fail-safe until the user runs the release branch. The vault prevents model and session-log disclosure but relies on the configured credentials provider for host storage protection. The quota meter is immediately visible after remounts and refreshes in the background; it remains absent when the provider supplies no valid telemetry.

## Testing

Focused attachment, DeepSeek serialization, pi-ai context, secret-vault, quota, and updater UI tests pass. The relevant TypeScript build passes, updater entry points pass syntax checks, and the source web server returns HTTP 200 with the client-module preload and without the plugin-load error. The local updater detects the current `stable` divergence and refuses unsafe mutation with a recoverable status.
