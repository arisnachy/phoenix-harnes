# Agent Note: Goal review tools follow the assembled runtime

Status: implemented

English | [中文](2026-09-09-goal-review-tools-follow-runtime.zh.md)

## Problem

The adversarial completion tester and final goal judge requested a fixed preferred tool list. Profiles that intentionally mounted fewer tools rejected the child before it could produce structured verification evidence, so goal completion was present in source but disconnected in those assembled runtimes.

## Decision

`availableReviewTools()` reads the parent agent's model-visible tool schemas and intersects them with each review stage's preferred tools. The adversarial execution child and the final judge receive only tools that the assembled parent runtime actually exposes. Preferred ordering remains stable, and no unavailable capability is invented.

The completion requirements remain unchanged. Missing capabilities can reduce the evidence a reviewer can gather, but they do not bypass the six completion checks, evidence ledger, artifact fingerprint, clean-room evidence, or final judge verdict.

## Alternatives considered

**Keep the fixed preferred list:** rejected because a valid minimal assembly cannot resolve tools it does not mount.

**Add every review tool to every profile:** rejected because it would override profile composition and expand capabilities without an operator choosing them.

## Verification

Focused goal and normalization tests pass 92 tests. The assembled ACP goal scenario now creates three real review children, persists their parent relationship, records the six-check completion gate and final judge pass, completes the goal, and delivers the closing message. The full keyless snapshot suite passes 122 tests with 8 intentional skips.

## Consequences

Minimal and provider-specific profiles can execute independent goal review without failing during tool restriction. Rich profiles still expose the full preferred review set. A profile with insufficient evidence remains unable to pass the existing completion requirements.
