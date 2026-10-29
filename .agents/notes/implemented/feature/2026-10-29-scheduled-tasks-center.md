# Agent Note: Scheduled Tasks Center in the Sidebar

Status: implemented

English | [中文](2026-10-29-scheduled-tasks-center.zh.md)

## Problem

PHOENIX already persists and dispatches proactive tasks, but users cannot create or control them from a dedicated navigation destination. The small conversation-header list cannot display all calendar recurrences. The sidebar's Discover action does not provide a reliable management route.

## Decision

Replace Discover in the primary sidebar and collapsed rail with Scheduled Tasks. Open a responsive task center from the sidebar shell without changing the session browser or workspace ownership. The center uses the existing loopback `/phoenix-tasks` service and shared persistent ledger: Kira and the user see the same visible tasks, their recurrence, status, next execution, and recent outcomes.

Add narrowly validated loopback `create`, `pause`, `resume`, and `cancel` endpoints to the existing task RPC. Browser creations are always attributed to the user and cannot set surprise visibility, mission scope, target agent, or elevated permissions. A visible-task membership check excludes unrevealed surprises from management. Require explicit recipients for scheduled email delivery; email and other external actions retain execution-time authorization.

The form supports one-time, interval, weekly, monthly and yearly schedules, with a local IANA timezone for calendar rules. The task center does not implement a second clock or scheduler; the host-owned proactivity engine remains responsible for persistence, admission, recovery, and work execution. Closing Phoenix prevents on-time local execution unless a separate host stays running, while pending occurrences are recovered on restart according to their catch-up policy.

## Alternatives considered

A separate browser scheduler would duplicate the global ledger and lose user/Kira synchronization. Sending task-creation instructions to a new chat would not give users deterministic form control or a full management view. Direct file edits from the browser would bypass host-side validation and concurrency serialization.

## Consequences

The sidebar depends on the existing authenticated local connection. The task center adds only browser state and delegates all durable changes to the host. The conversation-header task list remains a lightweight companion and now recognizes weekly and monthly schedules. Task histories describe accepted host outcomes and do not claim the user read a notification.

## Verification

Parser tests cover forbidden identities, unsupported fields, recurrence bounds, timestamps, email recipients and task IDs. UI tests cover task creation, pause, unavailable RPC, and dismissal. The host's existing proactivity-engine tests continue to own persistence, recovery, repeat dispatch and cancellation semantics.
