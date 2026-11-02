# Agent Note: Codex account probes reuse native SQLite state

Status: implemented

English | [中文](2026-09-23-codex-account-native-sqlite-reuse.zh.md)

## Problem

The Codex account bridge preserved the user's real `CODEX_HOME` for ChatGPT authentication but forced metadata-only account probes onto `CODEX_HOME/phoenix-runtime/sqlite/account`. Codex treats every fresh SQLite state database as an index over the rollout history under `CODEX_HOME`, so the first quota read had to backfill the user's complete Codex session history before the app-server could finish initialization. Codex's startup gate is bounded, so a large history could leave the private account database in `running`, exit the app-server, and let Phoenix retry the same cold backfill indefinitely. While that happened, `account/rateLimits/read` never returned and the 5h/7d quota UI could not receive fresh telemetry.

## Decision

Account, quota, usage, and connector probes now preserve `CODEX_HOME` and force their SQLite fallback to that same path twice: the child environment sets `CODEX_SQLITE_HOME=CODEX_HOME`, and the metadata app-server receives a highest-priority CLI `sqlite_home=CODEX_HOME` override. Metadata probes ignore both inherited/Profile `CODEX_SQLITE_HOME` and `PHOENIX_CODEX_SQLITE_HOME`. This second guard matters on Windows because a replacement Host can inherit the legacy `.../phoenix-runtime/sqlite/account` value from the process it replaces even after the source code stopped generating it. The CLI override also prevents a stale Codex config layer from selecting the retired Phoenix account database.

The account inspection failure cooldown increases from 30 seconds to 120 seconds. A native startup failure may already consume Codex's full state-backfill wait interval, so immediately launching another metadata app-server can keep refreshing the same failure loop and flood the Host log. Successful probes still use the existing one-minute telemetry TTL.

The previously added client-side persisted quota snapshot remains the UI fallback during a transient native refresh. This change restores the backend path that supplies fresh percentage and reset timestamps rather than relying on the fallback indefinitely.

## Alternatives considered

**Keep the private account SQLite database and raise Phoenix's probe timeout.** Rejected: Codex owns the startup backfill gate; a longer outer timeout does not make the metadata app-server finish after Codex has already exited.

**Delete or edit Codex backfill state automatically.** Rejected: Phoenix does not own the user's native Codex database and must not mutate provider-internal recovery metadata.

**Reuse the private one-shot subagent database.** Rejected: account reads do not need thread execution state, and coupling metadata polling to subagent history creates unnecessary contention and backfill work.

## Consequences

A normal Phoenix startup no longer selects the retired `phoenix-runtime/sqlite/account` database for quota probes, even when a stale Windows environment or Codex config still names it. Existing Phoenix-private account SQLite files are left untouched on disk. If the user's native Codex state under `CODEX_HOME` is itself unhealthy, account telemetry can still be unavailable; Phoenix backs off rather than repeatedly spawning a new failing app-server, while the UI retains the last trusted quota snapshot or explicit 5h/7d loading seats.

## Testing
## Testing

The package regression suite now checks that stale ambient and explicit Phoenix SQLite paths are discarded, the metadata child receives `CODEX_SQLITE_HOME=CODEX_HOME`, and the app-server command carries the matching CLI `sqlite_home` override. CI remains responsible for the package and assembled browser gates.
