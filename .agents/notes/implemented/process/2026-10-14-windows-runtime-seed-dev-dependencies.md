# Agent Note: Restore development dependencies after the Windows runtime seed

Status: implemented

English | [中文](2026-10-14-windows-runtime-seed-dev-dependencies.zh.md)

## Problem

The Windows desktop workflow builds a production runtime seed with `pnpm deploy` before running host, Game Studio, and Filesystem MCP guards. That deployment leaves the workspace in a production dependency state, so a later `pnpm exec` can trigger an implicit reinstall that prunes the development tools required by the guards.

## Decision

The Windows desktop job sets `pnpm_config_verify_deps_before_run` to `false` and restores the workspace explicitly with `pnpm install --frozen-lockfile --prod=false` after the production seed. The restore step runs `pnpm exec vitest --version` before the guard starts. The workflow regression checks the job setting, step order, explicit development install, and guard command.

## Alternatives considered

**Allow `pnpm exec` to repair the workspace.** Rejected because the implicit production repair prunes 412 development dependencies and makes the guard fail before its tests run.

**Change the runtime seed builder.** Rejected because the causal deployment behavior belongs to the production artifact build, while the workflow can restore its own test state at the exact point where it needs development tools.

## Consequences

The desktop job performs one explicit frozen development install after creating the production seed, and the remaining guards run against a stable workspace dependency state. The job no longer receives automatic dependency mutation during command execution; a missing development tool fails at the explicit restore or version check.

## Testing

`pnpm_config_verify_deps_before_run=false pnpm exec vitest run scripts/ci-workflow.spec.ts`
