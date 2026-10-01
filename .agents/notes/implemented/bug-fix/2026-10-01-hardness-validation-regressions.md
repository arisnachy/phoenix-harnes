# Agent Note: HARDNESS validation regressions

Status: implemented

English | [中文](2026-10-01-hardness-validation-regressions.zh.md)

## Problem

HARDNESS validation mixed obsolete policy expectations and incomplete agent fixtures with product defects. Serialized shell arguments hid commands at the beginning of a string, the broker delegated unbounded candle counts to custom market providers, and a fresh telemetry cache could suppress its first probe for one millisecond.

## Decision

Shell mutation classification reads the actual command argument. Nested tools invoked through code mode remain classified through their own execution hooks. The paper broker clamps requested and returned candles to 1–1000. Runtime telemetry performs its first probe regardless of the initial cache deadline, then retains ordinary TTL and concurrent-refresh behavior.

Tests use complete agent fixtures and a controlled wall clock for authorization telemetry and browser location expiry. Policy snapshots retain the current fast-mode and automatic image-provider rules. Error assertions distinguish schema-level non-finite-number rejection from adapter-level range validation; visual schemas retain their existing extensible object contract.

Conversational steering also exposed a reconstruction mismatch: short social turns filtered history while the invariant expected the complete log. Each such step now records its deterministic history projection; request construction and validation share that projection. SDK snapshots cover the persisted policy, and negative invariant tests continue to reject omitted or altered messages.

## Alternatives considered

Changing production prompts to satisfy stale literal assertions would reverse current policy. Adding quotation marks to the shell regex would classify unrelated JSON metadata as commands. Removing telemetry caching would add repeated account probes. These alternatives are rejected.

## Consequences

Boundary tests cover capped provider output, quoted asset paths, non-mutating shell metadata, immediate telemetry refresh, TTL reuse, and location expiry. The changes grant no new execution or connection authority. Existing mission and Loader tests continue to exercise assembled HARDNESS behavior.
