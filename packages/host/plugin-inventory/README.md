# @phoenix-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Host diagnostics service for the current Cordis Loader tree and PHOENIX stable-update lifecycle. `PluginInventoryGateway` registers the `pluginInventory` Remote namespace. `pluginInventory/list` remains a read-only point-in-time projection of non-group Loader entries; `pluginInventory/updateState` exposes a sanitized snapshot of the repository-local updater state; `pluginInventory/restartForUpdate` accepts a restart only when that trusted state is exactly `ready` with a valid prepared target.

The Loader inventory reads `ctx.loader.entries()` directly on every call, skips structural group rows, and returns Loader entry id, module specifier, effective enablement, and current root Fiber phase. The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. Loader remains the sole plugin-lifecycle authority, and this package owns no inventory cache or plugin-mutation path.

Updater state lives under the checkout's Git directory, outside `$DSH_HOME`. The Host bridge recognizes only the documented updater status vocabulary, bounds free-text fields, accepts only full 40-character commit ids, and never lets the browser supply an activation target. A restart request is bound to the exact `ready` target already written by the detached stable updater, then the Host schedules its own exit only after the request is durable. The updater process owns activation, rollback, and relaunch after the Host exits.

Public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`. The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only diagnostics and update-control service registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time plugin state only** — the inventory contains no durable plugin failure history or subscription; a missing root Fiber is reported as `null` regardless of why no live root exists.
- **Updater progress is phase-based** — the updater reports source, dependency, build, smoke, activation, and rollback phases rather than byte-level download percentages.
- **Restart is intentionally narrow** — Web can request activation only for the updater's exact prepared `ready` target; arbitrary checkout switching and plugin mutation are outside this service.
