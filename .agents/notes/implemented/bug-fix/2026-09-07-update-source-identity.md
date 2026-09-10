# Agent Note: Update source identity

Status: implemented

English | [中文](2026-09-07-update-source-identity.zh.md)

## Problem

A substring comparison accepts repository-name suffixes and foreign URLs containing the expected GitHub path. Such a match does not establish that an updater uses the configured source.

## Decision

Source and managed preflight and prepared activation share one exact repository matcher. It accepts GitHub HTTPS and Git SSH forms, checks the host and complete owner/repository path, and rejects credentials in HTTPS URLs, query strings, fragments and unrelated transports. Repository configuration remains explicit.

## Verification

Policy tests cover accepted transports and misleading URLs. Real updater processes run against disposable Git checkouts with a lookalike remote and reject it before fetching or changing the checkout. Adjacent state, upstream intake and prepared artifact checks remain required.

## Alternatives considered

- Keep substring matching: does not prove repository identity.
- Accept only HTTPS: excludes existing GitHub SSH installations.
- Hardcode one repository in every updater: duplicates policy and prevents explicit deployment configuration.

## Consequences

The shared check rejects ambiguous remotes consistently across update stages. It establishes source identity, not the safety of candidate code; staged verification and release authorization remain separate requirements.
