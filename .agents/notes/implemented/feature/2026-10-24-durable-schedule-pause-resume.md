# Agent Note: Persisted pause and resume for session-local schedules

Status: implemented

English | [中文](2026-10-24-durable-schedule-pause-resume.zh.md)

## Problem

Phoenix has durable session-local reminders but only create, list, and delete actions. A human or coordinator cannot temporarily prevent delivery without deleting the original reminder or scheduling another.

## Decision

Retain the existing version-1 `schedule/change` event stream and add two strictly decoded transitions: `pause` and `resume`. Folded state has disjoint active and paused sets. The original schedule target is never rewritten, and `schedule_list` projects both sets in original creation order. The runtime continues to read only active records; resuming a past-due record lets it become overdue. Deletion accepts either active or paused records. Per-agent FIFO transactions and pre/post persistence barriers protect the tool operations.

## Alternatives considered

**Keep pause only in browser local state.** Rejected because process restart would lose the decision while the Host might still dispatch.

**Delete and recreate on resume.** Rejected because it would lose the original identity and timing semantics, and open a race with dispatch.

## Consequences

Five model-facing tools are available to future root Agents where the Schedule plugin is installed. This change does **not** wake cold sessions, add a global task directory or notification delivery, or recover model-provider quota failures; those require Host-owned scheduling and authorization in a separate change.

## Testing

Strict decoding and transitions, integration tool calls and persistence uncertainty, and plugin installation/disposal have regression cases. Full workspace typecheck, generated catalogs, snapshots, CI, and Windows validation remain required before merge.
