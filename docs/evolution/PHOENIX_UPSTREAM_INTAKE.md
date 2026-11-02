# PHOENIX Codex and OpenClaw Update Intake

English | [中文](PHOENIX_UPSTREAM_INTAKE.zh.md)

PHOENIX receives updates from the official Codex plugin catalog and OpenClaw skill catalog through an isolated bridge-update channel.

## Commands

```text
dsh upstream-update --check
dsh upstream-update --apply
dsh upstream-update --doctor
```

The source checkout also starts the intake watcher with the PHOENIX process.

## Update policy

`PHOENIX_UPSTREAM_UPDATE_MODE=auto` is the default and stages and activates updates for bridges that are already configured.

`PHOENIX_UPSTREAM_UPDATE_MODE=notify` records an available revision without changing the installed bridge.

`PHOENIX_UPSTREAM_UPDATE_MODE=off` disables the intake watcher and checks.

The watcher polls every ten minutes by default; `PHOENIX_UPSTREAM_UPDATE_POLL_MS` changes the interval and is clamped to at least thirty seconds.

An unconfigured bridge remains idle and is not silently initialized by the watcher.

## Staging and activation

The intake reads the installed bridge state and compares its recorded commit with the official `main` head returned by `git ls-remote`.

When a revision is available, each changed bridge is synchronized in a private staging home on the same volume as `$DSH_HOME`; `PHOENIX_UPSTREAM_UPDATE_TEMP` can select its parent directory.

The candidate runs the native `sync` and `verify` commands before activation, and its state must identify the expected official repository and exact observed commit.

Activation moves only the bridge-owned roots and namespaced managed skills; user-owned skills remain outside the transaction.

The transaction journal records every rename before and after it executes, and a failed live verification reverses the completed operations from the journal backup.

An interrupted transaction is recovered before the next check or apply operation.

## Safety and trust

A network error, malformed candidate, bridge error, or failed rollback never becomes a PHOENIX profile boot dependency; the intake records `blocked` state and retries during the next watcher cycle.

Generated state and MCP patches reject legacy `@deepseek-ai/` references and literal credential-like values; environment references remain references and their values are never copied into update state.

The intake changes user bridge data under `$DSH_HOME`, but it does not modify PHOENIX source, `main`, `stable`, sessions, memories, projects, or credentials.

The intake does not claim that an upstream skill or plugin's optional CLI, API, account, device, or credential is available; those capabilities remain subject to their own bridge and permission checks.
