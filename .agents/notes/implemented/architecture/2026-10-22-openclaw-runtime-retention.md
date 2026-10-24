# Agent Note: OpenClaw runtime retention

Status: implemented

English | [中文](2026-10-22-openclaw-runtime-retention.zh.md)

## Problem

OpenClaw updates create versioned runtimes, isolated Node directories, distribution archives, and an npm cache under `$DSH_HOME/openclaw-runtime`. Without a bounded retention owner, old installations accumulate while a broad recursive cleanup could remove state or follow a link outside the managed runtime.

## Decision

[`scripts/phoenix-runtime-retention.mjs`](../../../../scripts/phoenix-runtime-retention.mjs) plans cleanup only inside the managed `versions`, `node`, `artifacts`, and explicitly requested `npm-cache` children. The active, previous, and candidate markers contribute runtime, Node, and artifact references that remain retained; unknown entries remain untouched. Version and staging names, Node runtime names, and OpenClaw or Node archive names must match the managed naming rules before they become targets.

The planner reads marker files as regular files, requires referenced paths to be absolute and contained by the runtime root, and fails closed when a marker, managed root, candidate target, or descendant is a symlink or Windows reparse point. It also checks the DSH home ancestors and requires the exact `openclaw-runtime` child name. A blocked plan exposes no executable targets. The apply API requires the caller's shared runtime lock, `dryRun: false`, and `confirm: true`; it re-plans from the exact home, accepts only the unchanged target set, compares marker revisions and retained heads, and repeats those checks immediately before each deletion. It never includes Phoenix state, OpenClaw state, credentials, or marker files in the deletion allowlist.

## Alternatives considered

**Deleting the entire `openclaw-runtime` directory** was rejected because it would include sessions, configuration, credentials, and lifecycle markers.

**Keeping only the active runtime** was rejected because rollback and a prepared candidate require the previous and candidate installations to survive retention.

**Following links while enumerating managed entries** was rejected because a junction or symlink can redirect recursive deletion outside the isolated runtime.

**Running cleanup implicitly after planning** was rejected because installation lifecycle ownership, the shared runtime lock, and Phoenix global-idle proof belong to the caller; this module exposes dry-run planning and an explicitly confirmed apply operation.

## Consequences

Retention is deterministic and reviewable before mutation. Staging directories and npm-cache are eligible only while the caller declares the shared runtime lock and no live installer; a caller may omit npm-cache when another process owns that cache. Tests use temporary fixtures and verify marker retention, state/config/credential preservation, path containment, ancestor protection, link rejection, stale-plan rejection, dry-run behavior, explicit confirmation, and per-delete revalidation. No real `$DSH_HOME` data is cleaned by this change.
