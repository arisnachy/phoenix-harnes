# Agent Note: atomic updater state writes

Status: implemented

English | [中文](2026-08-30-atomic-update-state.zh.md)

## Problem

The Host polls `phoenix-update-state.json` while the updater publishes lifecycle changes. A direct overwrite can expose truncated JSON between the file open and the final write. The Host then reports a generic update error even though the update operation is still healthy.

## Decision

All updater entry points persist state through `scripts/phoenix-update-state.mjs`. The helper writes the complete JSON document to a process- and UUID-scoped sibling temporary file and renames it over the destination. The Host now uses the same atomic replacement for both the restart request and the `restarting` state, and retries short-lived Windows replacement locks. Cleanup removes only that invocation's temporary file; the bounded Host read retry remains a defense for filesystem timing and legacy installations.

## Alternatives considered

**Only increase Host retries.** This reduces the race window but still permits a reader to observe incomplete state and makes the result depend on timing.

**Ignore malformed state.** This hides real persistence failures and can leave the interface showing stale lifecycle information.

**Use a database for updater state.** The updater needs a small repository-local document before the full runtime is available; adding a database would expand the boot and recovery dependencies.

## Consequences

The browser sees either the previous complete state or the new complete state. Concurrent updater processes cannot share a temporary filename, and a short-lived Windows file lock is retried without hiding persistent failures. A failed write leaves the previous destination untouched, while a temporary sibling file is cleaned up. The state file remains a simple JSON document and stays outside user sessions, credentials, and memories. The prepared-candidate marker uses the same helper, so preparation cannot publish a partial target. The sidebar now distinguishes active progress, ready-to-restart, reconnecting, and durable error states; durable errors expose a safe immediate retry of the next state read without showing raw transport or Git details.

## Testing

`scripts/phoenix-update-state.spec.ts` writes two successive states and verifies the final JSON and temporary-file cleanup. The Host state tests verify restart persistence and cleanup of both atomic writes. The updater UI tests verify the retry action, lifecycle rendering, reconnect behavior, and the compact rail. `node --check` passes for the helper and all three updater entry points. `node scripts/phoenix-auto-update.mjs --self-test` passes. The focused Host and updater UI suite passes 2 files and 43 tests after the UI retry addition; the earlier four-file regression suite passed 44 tests.
