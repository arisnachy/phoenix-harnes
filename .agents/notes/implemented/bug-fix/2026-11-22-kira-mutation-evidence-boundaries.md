# Agent Note: Kira verification evidence after mixed and namespaced mutations

Status: implemented

English | [中文](2026-11-22-kira-mutation-evidence-boundaries.zh.md)

## Problem

The completion-quality guard classified only a small set of exact mutation names. A successful GitHub merge, reference update, or other namespaced operation could leave the evidence ledger incorrectly clean. In shell calls that both changed state and ran tests, matching a test command first could likewise mark an unverified final state as verified.

## Decision

Classify operation families from normalized tool names rather than only file-specific names. Track GitHub PR/ref and file-library write operations as mutations. Give shell mutations precedence over verification when a single call contains both kinds of activity, and recognize common GitHub CLI merges and git push/tag commands. Keep the existing generation-based, bounded, low-latency steering rather than adding a second evaluator or model round.

## Limits

Tool-name and command-text recognition is heuristic, not authoritative effect metadata. A new tool family can still require a declared effect type from the owning adapter. Combined shell commands are intentionally classified conservatively, even if their last subcommand happened to be a test. The quality guard does not independently run checks, guarantee an external commit, or prove a deployed application works.

## Verification

Regression tests cover namespaced GitHub write calls, file-library mutation, mixed edit-and-test shell calls, and the end-to-end guard's corrective steer after a simulated successful PR merge. Real Windows startup, provider execution, and full repository CI remain separate promotion gates.
