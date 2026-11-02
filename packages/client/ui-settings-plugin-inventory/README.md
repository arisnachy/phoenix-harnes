# @phoenix-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

Web **Plugin list** Settings tab plus the PHOENIX stable-update footer action. The browser plugin registers the localized `settings.plugins.tab` contribution with id `all` and an independent `sidebar.footer.action` contribution with id `phoenix-update`. Both registrations use `ctx.slots.inject()`, so they follow late slot declaration, redeclaration, locale changes, and teardown without importing a presentation owner at runtime.

The Plugin list remains lazy and read-only. Selecting the tab for the first time calls `ctx.remote.pluginInventory.list()` through [`api-remotes`](../../api/remotes/README.md) and renders the searchable Loader catalog. Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details.

The update action polls the repository-local `pluginInventory.updateState` Remote while Web is open. Idle, routine checking, current, completed, disabled, and development-branch states consume no sidebar space. A real stable release, preparation phase, actionable failure, or prepared restart appears immediately above Settings as a compact one-line action with a status glyph, localized phase, optional target commit prefix, and a thin accessible progress indicator while work is active. The collapsed sidebar rail renders the same state as an icon with a tooltip. Progress remains phase-based rather than a fabricated byte percentage.

Only `ready` becomes a restart action. The compact row shows **Update ready** and **Restart now**; clicking it calls `pluginInventory.restartForUpdate`. The Host accepts that request only for the exact target already prepared by the detached stable updater. Once accepted, the UI moves to the restarting state, the Host exits, and the detached updater owns activation, rollback on failure, and automatic relaunch. Rejected or failed restart requests stay in the current process and refresh or show a generic update failure instead of closing PHOENIX. Temporary Host/RPC read failures stay invisible and keep polling; they are never mislabeled as update failures. A durable updater error keeps the previous stable version, offers an immediate safe retry, and automatically wakes the updater after 15 seconds with exponential delays capped at five minutes while the failure remains. Development-branch pauses stay invisible; other paused states remain available as compact actionable status.

## Model Experience

None, as this package only visualizes Host-owned deployment and update state in the browser and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One plugin snapshot per Settings mount or retry** — the Plugin list does not subscribe to Loader changes or automatically refetch after reconnect; reopening Settings obtains a new snapshot.
- **Updater progress is phase-based** — the sidebar intentionally reports meaningful preparation stages, not byte-level download percentages.
- **Restart is the activation boundary** — preparation completes while the current runtime remains live, but a prepared release does not replace that runtime until the user requests Restart or closes PHOENIX normally.
