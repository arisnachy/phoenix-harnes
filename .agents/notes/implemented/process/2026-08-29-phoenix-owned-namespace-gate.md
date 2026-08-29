# Agent Note: PHOENIX-owned namespace gate

Status: implemented

English | [中文](2026-08-29-phoenix-owned-namespace-gate.zh.md)

## Problem

The repository contains Phoenix-owned packages beside vendored upstream Cordis packages. A broad search for `@deepseek-ai/*` therefore mixes stale Phoenix package names with legitimate upstream framework identities, while a narrow migration count can miss active manifests or profile composition files.

## Decision

`scripts/verify-phoenix-namespace.ts` scans tracked active product files and rejects every Phoenix-owned `@deepseek-ai/dsh-*` reference and every unclassified `@deepseek-ai/*` reference. It excludes vendored source and frozen or historical Agent Notes. The exact vendored Cordis, Cosmokit, Schemastery, and Cordis plugin package identities are allowlisted because their package contracts and source ownership remain upstream. The check runs in the shared static gate and is available as `pnpm run verify-phoenix-namespace`.

The gate verifies package identity, not brand prose or historical migration records. Those surfaces keep their own provenance and branding checks.

## Alternatives considered

- **Replace every `@deepseek-ai/*` token.** Rejected because it would repackage the vendored framework and break its explicit peer-dependency and provenance contract.
- **Trust a one-time bulk replacement count.** Rejected because it cannot prevent stale profile, manifest, or future source references from returning.
- **Scan vendored source and frozen notes.** Rejected because those files intentionally preserve upstream identity or immutable history and are not active Phoenix package surfaces.

## Consequences

Active Phoenix package references now fail closed when they use the old product scope, while legitimate upstream dependencies remain explicit and auditable. A clean gate proves the active repository surface is migrated; it does not claim that upstream provenance or historical notes were erased.
