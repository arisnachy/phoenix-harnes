# Agent Note: Shared local attachment publication and read helpers

Status: implemented

English | [中文](2026-09-08-shared-attachment-publication-and-read-helpers.zh.md)

## Problem

Image and arbitrary-file storage duplicated the full atomic publication path, while their read functions duplicated byte loading and error normalization. Separate copies could diverge in validation, durability, cleanup, or cancellation behavior.

## Decision

[`store.ts`](../../../../packages/attachment/attachment-local/src/store.ts) owns private `commitPreparedAttachment()` and `readStoredAttachment()` helpers. The commit helper validates digest and byte count, establishes durable directories, writes with owner-only permissions, fsyncs, verifies hard-link deduplication, and cleans staging files; an image/file kind preserves each public diagnostic message.

The read helper forwards the caller's signal to `readFile()`, preserves `ENOENT` and read-failure mapping, and checks cancellation after the read. Public image and file functions retain their existing reference ordering and media-specific metadata or byte verification after the shared read.

## Verification

Focused attachment store and public service tests passed: 2 files, 20 tests passed, and 1 platform-specific test skipped. Focused Oxlint, no-emit TypeScript, and jscpd checks passed for `store.ts`.

## Alternatives considered

**Suppress the duplication report:** rejected because an ignore would hide future drift in storage integrity and cleanup logic.

**Expose one common public attachment operation:** rejected because image metadata verification and arbitrary-file byte verification are distinct public contracts.

**Keep parallel private copies:** rejected because the shared publication and read rules would remain vulnerable to divergence.

## Consequences

Future changes to common attachment publication, filesystem diagnostics, or read cancellation have one owning helper. Image normalization and metadata checks, arbitrary-file admission and byte checks, content hashing, atomic hard-link publication, rollback, and durable directory synchronization remain in force.
