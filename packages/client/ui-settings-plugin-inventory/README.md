# @phoenix-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

Web **Plugin list** Settings tab plus the PHOENIX stable-update footer action. The browser plugin registers the localized `settings.plugins.tab` contribution with id `all` and an independent `sidebar.footer.action` contribution with id `phoenix-update`. Both registrations use `ctx.slots.inject()`, so they follow late slot declaration, redeclaration, locale changes, and teardown without importing a presentation owner at runtime.

The Plugin list remains lazy and read-only. Selecting the tab for the first time calls `ctx.remote.pluginInventory.list()` through [`api-remotes`](../../api/remotes/README.md) and renders the searchable Loader catalog. Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details.

The update action polls the repository-local `pluginInventory.updateState` Remote while Web is open. It consumes no sidebar space while PHOENIX is current. When a stable release is detected it appears immediately above Settings and follows the updater's real lifecycle: source fetch, dependency preparation, build, smoke verification, ready, restart, activation, and rollback/error states. The compact sidebar rail renders the same state as an icon with a tooltip; the expanded sidebar shows localized text. The state is phase-based rather than a fabricated byte percentage.

Only `ready` becomes an action. The expanded row shows **Update ready** and **Restart to complete update**; clicking it calls `pluginInventory.restartForUpdate`. The Host accepts that request only for the exact target already prepared by the detached stable updater. Once accepted, the UI moves to the restarting state, the Host exits, and the detached updater owns activation, rollback on failure, and automatic relaunch. Rejected or failed restart requests stay in the current process and refresh or show a generic update failure instead of closing PHOENIX.

## Model Experience

None, as this package only visualizes Host-owned deployment and update state in the browser and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One plugin snapshot per Settings mount or retry** — the Plugin list does not subscribe to Loader changes or automatically refetch after reconnect; reopening Settings obtains a new snapshot.
- **Updater progress is phase-based** — the sidebar intentionally reports meaningful preparation stages, not byte-level download percentages.
- **Restart is the activation boundary** — preparation completes while the current runtime remains live, but a prepared release does not replace that runtime until the user requests Restart or closes PHOENIX normally.
