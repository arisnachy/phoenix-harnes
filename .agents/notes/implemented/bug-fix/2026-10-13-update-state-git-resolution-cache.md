# Agent Note: Update state reads reuse Git directory resolution

Status: implemented

English | [中文](2026-10-13-update-state-git-resolution-cache.zh.md)

## Problem

A live runtime CPU profile during browser loading attributed repeated synchronous Git subprocesses to `pluginInventory.updateState`. Each RPC resolved the same Git common directory before reading the updater state, blocking unrelated server work while Git ran.

## Decision

Cache only the resolved control directory by runtime root and Git marker identity. Linked-worktree marker files include bounded content and metadata so replacing or rewriting the pointer invalidates the cached path. Removing and restoring the marker also re-resolves it. State JSON is read and parsed on every call; restart and refresh requests retain the common control directory.

## Alternatives considered

**Cache the entire snapshot.** This would conceal updater progress or errors.

**Cache all server bundles.** The profile identified repeated Git resolution, rather than persistent file reads, as the demonstrated blocking operation.

**Restart the active runtime to diagnose it.** An isolated browser and temporary loopback inspector provided evidence without interrupting sessions; the inspector was closed afterward.

## Consequences

The [atomic updater state writes](2026-08-30-atomic-update-state.md) decision remains active: caching directory identity preserves its fresh reads, atomic persistence and bounded retry behavior.

Repeated update-state reads no longer launch Git while the marker is stable. A local comparison of twenty warmed reads measured 2,755 ms before the change and 15 ms afterward. This is a measurement of that operation, not an authenticated voice latency or whole-page speedup. The first resolution and actual marker changes still run Git.

## Verification

Tests cover repeated reads, fresh JSON, shared worktree directories, missing/restored markers, in-place pointer rewrites, and restart/refresh destinations. Live application uptake and whole-page timing require separate verification after publication.
