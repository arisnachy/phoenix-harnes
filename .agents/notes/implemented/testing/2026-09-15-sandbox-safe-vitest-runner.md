# Agent Note: A sandbox-safe Vitest runner that leaves the fork pool in place

Status: implemented

English | [中文](2026-09-15-sandbox-safe-vitest-runner.zh.md)

## Problem

`pnpm run test` cannot start inside an agent sandbox that denies `child_process.spawn`, even though the suite itself is healthy. Two independent spawns happen before the first test file loads.

Vite 8 resolves Windows real paths by running `exec("net use")` from `optimizeSafeRealPathSync`, reached while the config file is bundled. A denied spawn surfaces as `Error: spawn EPERM` reported against `failed to load config from vitest.config.ts`, so the failure reads as a broken config rather than a restricted environment.

The default `pool: 'forks'` starts each test file in a forked child process, which is the second denied spawn.

Only the first of these is incidental. `pool: 'forks'` exists because Node 24 aborts the CJS lexer under worker threads, and `scripts/ci-workflow.spec.ts` pins it with a contract test that requires exactly two `pool: 'forks'` declarations. Removing it to satisfy a sandbox would trade an environment restriction for a runtime defect on a supported Node version.

## Decision

The default configuration is unchanged, and an opt-in launcher supplies a path for spawn-restricted environments. Three files carry it.

`scripts/vitest-sandbox-preload.cjs` wraps `node:child_process.exec` and answers only the `net use` command that Vite issues for drive-letter enumeration; every other command reaches the original implementation. The wrapper invokes its callback on `process.nextTick` with empty output and stub `stdout`, `stderr`, and `stdin` streams, matching what callers of that signature read.

`scripts/test-sandbox.mjs` sets `NODE_OPTIONS=--require=<preload>` and runs the real Vitest CLI with `--pool=threads`, forwarding the caller's remaining arguments. It resolves pnpm through `npm_execpath`, because pnpm is a `.cmd` and `.ps1` shim on Windows and cannot be spawned directly.

`package.json` exposes the launcher as `test:sandbox`.

`vitest.config.ts` is untouched: both `pool: 'forks'` declarations remain, and `scripts/ci-workflow.spec.ts` passes without modification.

## Testing

`pnpm run test:sandbox -- packages/util/atomic-write/tests/invariant.spec.ts --reporter=dot` reports `Test Files 1 passed (1)` and `Tests 1 passed (1)`. Unmodified `pnpm exec vitest run` on the same file fails during config load with `spawn EPERM`.

Run under the launcher, that package reports `7 passed | 1 failed`. The failure is `EPERM: operation not permitted, symlink` at `packages/util/atomic-write/tests/atomic-write.spec.ts:66`, a separate restriction on symlink creation that this change does not claim to solve.

`scripts/ci-workflow.spec.ts` reports `2 failed | 14 passed` under the launcher, and its process-isolation case passes. Those two failures concern `.github/workflows/ci.yml` job names and predate this change.

## Alternatives considered

**Change the default pool to `threads`.** Rejected: Node 24 aborts the CJS lexer under worker threads, so this trades a sandbox restriction for a runtime defect, and it breaks the contract test that pins the fork pool.

**Detect the sandbox and select the pool automatically.** Rejected: the pool would then depend on an environment property no caller can observe, so the same commit would run with different isolation on a developer machine and in CI while neither result explained which had been used.

**Patch or vendor Vite to skip the `net use` probe.** Rejected: a vendored dependency has to be re-diffed on every upgrade, and the probe is only unreachable when spawning is already denied, which the launcher addresses without touching a dependency.

**Require callers to supply the preload themselves.** Rejected: it turns every invocation into a two-step sequence that is easy to get half-right, and the half-right state produces the misleading config-load error above.

## Consequences

The suite runs in a spawn-restricted sandbox while CI keeps the isolation it had. The cost is a second documented entry point: `test` and `test:sandbox` differ in both pool and loader, so a passing run under one is not evidence about the other's process isolation.

The preload is an environment shim rather than product code. Only `scripts/test-sandbox.mjs` loads it; `vitest.config.ts` and every runtime entry are unaffected, and the wrapper delegates any command it does not recognize.
