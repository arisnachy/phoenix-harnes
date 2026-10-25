# Agent Note: Dual engine runtime isolation

Status: implemented

English | [中文](2026-10-21-dual-core-engine-runtime.zh.md)

## Problem

PHOENIX needs Codex and OpenClaw execution engines to coexist while an OpenClaw update remains isolated from the host Node installation, Phoenix update state, credentials, and live executions.

## Decision

The script [`scripts/phoenix-engine-runtime.mjs`](../../../../scripts/phoenix-engine-runtime.mjs) owns the narrow lifecycle for an OpenClaw candidate under `$DSH_HOME/openclaw-runtime` and exposes inspection, preparation, activation, rollback, start, and stop operations as asynchronous functions.

Official preparation fetches only the pinned npm metadata and tarball for `openclaw/openclaw`, plus the pinned official Windows x64 Node archive. It verifies the registry SHA-512, the Node `SHASUMS256.txt` SHA-256, archive containment, and the fixed `package/openclaw.mjs` bytes before staging. It installs the verified tarball through the isolated Node `npm-cli.js` with `--ignore-scripts`, `--omit=dev`, `--no-audit`, and `--fund=false`; the candidate entrypoint remains under `runtimePath/node_modules/openclaw/openclaw.mjs` so package-relative imports remain valid. Preparation uses a lock, bounded downloads and process output, an explicit configurable install timeout, and writes no active marker or global Node state. The compatibility helper independently fetches and compares official metadata before accepting an already staged candidate.

Activation starts the candidate with the selected Node executable and entrypoint, fixed `gateway run --bind loopback --port <port>` arguments, private `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` values under the isolated runtime, a scrubbed environment, `shell: false`, and `windowsHide: true`. The official `openclaw health --json` command must exit successfully with a non-starting JSON object while the gateway child remains alive before the active marker changes.

Phoenix live, uncertain, or in-flight execution phases defer activation and rollback. Failed health or process checks leave the prior active marker in place. The inspection result reads Codex from `$DSH_HOME/codex-cli/active.json`, combines the Phoenix managed marker and update state with the isolated OpenClaw markers, and does not return environment values or credentials.

## Alternatives considered

**Installing OpenClaw into the host Node environment** was rejected because the supported OpenClaw Node line can differ from the Phoenix host line and a global mutation would couple engine lifecycle to host upgrades.

**Accepting arbitrary package URLs or repository identities** was rejected because an updater must verify the official `openclaw/openclaw` registry metadata and a pinned digest before activation.

**Replacing the active marker before health verification** was rejected because a failed gateway must preserve the last verified runtime and leave rollback possible.

**Starting with inherited arguments, channels, or tokens** was rejected because this adapter owns process supervision only; credentials and channel configuration remain an explicit higher-level responsibility.

## Consequences

The adapter is a filesystem and process lifecycle seam with a bounded official preparation path. The parent updater decides when installation is appropriate, while this module enforces source and digest pinning, isolated Node/npm state, health checks, busy deferral, and marker transitions.

The test runner is injectable for deterministic lifecycle checks. The default readiness probe uses the official loopback `/readyz` HTTP endpoint with bounded response size and request time; it does not launch another CLI on each poll. Readiness requires successful HTTP admission, explicit successful JSON and a live child process. Initial startup has a bounded ten-minute allowance because a real Windows cold start was still importing session modules after three minutes; ordinary health and stop checks retain their shorter budgets. Active, start, and rollback transitions reverify the artifact and entrypoint digest, serialize per isolated runtime, and retain the marker on write or quiescence failure. A durable owner-handle lock makes a concurrent or unknown cross-process owner fail closed. Stop waits for the owned child and never kills a persisted PID after its process handle is gone. Fixture checks do not certify native Gateway compatibility.

The active marker contains launch metadata and status only. It does not persist environment variables, authorization headers, token values, channel definitions, or arbitrary command arguments.

## Evidence boundary

Focused checks cover official source and archive verification, bounded output and waits, failed candidate restoration, HTTP readiness, artifact revalidation, busy deferral and serialized lifecycle operations. Official OpenClaw 2026.10.5 preparation completed with isolated Node 24.22.1. A bounded isolated native check authenticated protocol 4 and verified health; a separate check completed public sessions, agents, cron, skills and channel-status reads plus transport reconnection. The expanded harness then failed temporary-file cleanup with `ENOTEMPTY`; subsequent process and port inspection found no remaining owned Gateway. These checks do not certify a model-backed operational task, channel delivery, persistent activation, native upgrade or rollback. Lifecycle controls remain unavailable until the global idle proof is implemented.
