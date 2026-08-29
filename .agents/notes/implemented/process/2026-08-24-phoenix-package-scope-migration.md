# Agent Note: PHOENIX package scope migration inventory

Status: implemented

English | [中文](2026-08-24-phoenix-package-scope-migration.zh.md)

## Problem

PHOENIX inherited the `@deepseek-ai/*` npm namespace. Renaming package identities affects manifests, imports, Cordis client module ids, generated Typert references, peer dependencies, the workspace lockfile, and build artifacts together. A partial rename can produce a mixed runtime.

## Decision

Rename the PHOENIX-owned package family to `@phoenix-ai/*` in one workspace-wide mechanical batch, then reinstall and regenerate derived catalogs. Keep `@deepseek-ai/cordis`, `@deepseek-ai/cosmokit`, `@deepseek-ai/schemastery`, and the vendored Cordis plugin names as upstream identities. The batch is local to the feature branch; `main` and `stable` remain unchanged until publication gates pass.

## Alternatives considered

A literal rename of every `@deepseek-ai/*` name was rejected because it would repackage upstream Cordis and its provenance. A partial package-only rename was rejected because manifests, generated artifacts, and lockfile entries would disagree.

## Consequences

The current feature branch has no active legacy DSH-scope references outside archived notes and has reinstalled the workspace against the new package identities. Remaining `@deepseek-ai/*` references are upstream dependencies or historical/provenance records and must not be treated as PHOENIX package contamination. A full build and clean publication verification are still required before promotion.
