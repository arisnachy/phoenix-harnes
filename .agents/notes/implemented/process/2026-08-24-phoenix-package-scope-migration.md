# Agent Note: PHOENIX package scope migration inventory

Status: implemented

English | [中文](2026-08-24-phoenix-package-scope-migration.zh.md)

## Problem

PHOENIX still uses the inherited `@deepseek-ai/*` npm namespace for its workspace and vendored packages. Renaming package identities directly on `main` would affect manifests, imports, Cordis client module ids, generated Typert references, peer dependencies, the workspace lockfile, and build artifacts at the same time. A partial rename can therefore produce a mixed runtime that resolves some packages under the old scope and others under the new one.

## Decision

Add a read-only migration planner that discovers tracked `package.json` files, inventories every package whose name starts with `@deepseek-ai/`, and derives the corresponding `@phoenix-ai/` target name. The planner fails when two legacy packages map to one target or when a target name already exists in the workspace. It does not rewrite package manifests, imports, generated files, or the lockfile.

The first migration phase is therefore observational and safe on `main`. Later rename batches must use this inventory as their package-identity source and regenerate the lockfile and built artifacts as one coherent change.

## Alternatives considered

- Rename every package and import in one change. Rejected because a partial failure would leave a mixed namespace across manifests, generated references, the lockfile, and runtime resolution.
- Rewrite manifests incrementally. Rejected because package identity is a graph-wide invariant; updating only some packages makes peer and workspace resolution ambiguous.
- Keep the planner as an untracked one-off script. Rejected because the migration inventory needs to be reproducible and reviewable before any mutating rename batch.

## Consequences

`node scripts/plan-phoenix-scope-migration.mjs` prints the complete legacy-to-PHOENIX package map. `node scripts/plan-phoenix-scope-migration.mjs --check` performs the collision and consistency checks without mutating the repository. The current runtime remains on `@deepseek-ai/*` until a validated rename batch is executed.
