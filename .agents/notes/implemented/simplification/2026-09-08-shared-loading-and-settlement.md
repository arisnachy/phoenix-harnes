# Agent Note: Shared loading and settlement

Status: implemented

English | [中文](2026-09-08-shared-loading-and-settlement.zh.md)

## Problem

Ledger loading, repository text scanning, lock identity parsing, and runtime settlement had duplicated implementations that could diverge in failure handling.

## Decision

The two memory ledgers share an ordered JSONL reader. It preserves physical line numbers, missing-file behavior, parse-error causes, and records applied before a later invalid row. Validation remains owned by each ledger. Repository scanners share tracked-text enumeration, including symlink text, binary exclusion, and missing-file handling. Gate locks share identity parsing while retaining owner-specific validation.

Python and worker-thread providers share settlement of a snapshot of active runs. Each provider rejects new runs before settling existing runs and waits for their completion. Taking a snapshot preserves settlement when callbacks mutate the live set.

## Alternatives considered

Parsing all rows before applying any would change recovery behavior on malformed ledgers. Iterating the live run set during settlement would let callbacks skip other runs. Suppressing duplication reports would preserve independent copies of these rules. These alternatives were rejected.

## Verification

Focused tests cover malformed JSON, physical line numbers, partial application, missing files, validation errors, tracked-file filtering, lock ownership, and settlement during set mutation. Provider subprocess tests exercise execution and disposal separately from the shared helper.

## Consequences

The helpers centralize existing behavior without combining ledger validation or provider process management. Real provider and repository checks remain necessary alongside helper tests.
