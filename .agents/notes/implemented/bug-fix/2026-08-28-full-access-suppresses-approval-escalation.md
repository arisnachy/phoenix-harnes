# Agent Note: Full access suppresses approval escalation

Status: implemented

English | [中文](2026-08-28-full-access-suppresses-approval-escalation.zh.md)

## Problem

The `danger-full-access` preset selected the unrestricted file mode but retained the `ask` approval policy. A session that selected Full access could therefore ask for a second approval when a tool retried an operation as a sandbox escalation to `danger-full-access`.

## Decision

The shipped `danger-full-access` preset bundles `danger-full-access` with the `never` approval policy. The host preset table and the browser fixture use the same bundle and description. The browser still requires an explicit risk acknowledgement when enabling Full access; after that acknowledgement, file operations do not create an additional approval wait.

## Alternatives considered

**Keep `ask` for Full access and accept two confirmations.** Rejected: the Full access acknowledgement already records the user's deliberate mode selection, and a second escalation prompt describes a transition that has already happened.

**Suppress only the browser approval panel.** Rejected: presentation-only suppression would leave the host policy at `ask`, so other clients and direct command paths would retain the inconsistent behavior.

## Consequences

Selecting Full access now records `approval/policy: never` alongside `sandbox/mode: danger-full-access`; approval requests in that session fail closed rather than opening an approval panel. `workspace-write` continues to use `ask`, and the Full access risk confirmation remains required in the browser.
