# Agent Note: Client boot overlaps prefetch and entry creation

Status: implemented

English | [中文](2026-10-12-overlap-client-boot-prefetch.zh.md)

## Problem

The browser started immediate-tier prefetch, then waited for it to finish before creating the full plugin graph. A real browser trace showed later bundles starting in a second HTTP wave. Fast individual server responses therefore did not establish a fast usable interface.

## Decision

Client boot starts entry creation while immediate-tier prefetch is still running. The existing module arrival registry deduplicates overlapping requests and dependency imports retain their existing ordering. Boot waits for both operations before checking Loader quiescence and activation. Failure reporting, all-ACTIVE auditing and the single renderer mount remain authoritative.

The [client plugin loading model](../architecture/2026-07-23-client-plugin-loading-model.md) and [web client architecture](../architecture/2026-07-19-gui-web-client-architecture.md) remain active: this change overlaps downloads without changing module identities, service injection, two-phase boot responsibilities or renderer ownership.

## Alternatives considered

**Cache every bundle on the server.** Later measurements found intermittent high server CPU and delayed first bytes even for a tiny manifest. They did not establish file reads as the cause; a bundle cache would not address the demonstrated scheduling delay.

**Render before plugins settle.** Partial activation would conceal missing services and change the existing startup guarantee.

**Drop immediate prefetch.** Existing preload priority can overlap entry imports without removing it.

## Consequences

Dependent bundles can begin arriving earlier without duplicate materialization. This does not remove HTML transport delays, provider reasoning time or native voice final-result waits. A browser trace identifies a scheduling delay; only controlled before/after measurements can quantify a speedup.

## Verification

Boot tests must keep prefetch unresolved while observing entry creation, preserve failure handling and prove the application mounts after settlement. The built application smoke provides Loader and renderer composition evidence. Live measurements use an isolated browser rather than interrupting the user's active session.
