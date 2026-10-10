# Phoenix: cold wake, calendar recurrence and safe self-scheduling

Status: implementation in this branch (automated tests added; Windows runtime validation required).

## Problem and scope

Phoenix already has durable scheduled tasks, watch conditions, connector events and a read-only attention surface. It did not reliably resume the **original** session for event-driven wake requests: when the stored target was absent, the event could be sent into an unrelated live conversation instead. The proactive engine also lacked native timezone-aware weekly and monthly recurrence, and multiple autonomous turns could submit duplicate standing work.

## Changes

- Event-driven wake restores an existing target session through the agent registry and re-composes its persisted preset using the same host compositor as scheduled tasks.
- It never substitutes another active session for a named but absent target; failures stay failed for a later delivery attempt instead of being silently reported as successful.
- A cold wake waits for its agent to become idle before recording success and disposes its lease even when execution fails.
- Phoenix tasks accept `everyWeeks` and `everyMonths` along with `timezone`. Weekly/monthly recurrence preserves local time across DST; a monthly 31st resumes on the 31st after a shorter month.
- The JSON ledger retains a normalized `calendar` recurrence and the original monthly day, so restarts do not lose the anchor. Existing `once`, `interval` and `yearly` snapshots remain valid.
- Phoenix-originated equivalent active tasks are deduplicated; user-created duplicate reminders remain permitted.
- The model-facing proactivity rules prioritize verified high-benefit follow-ups inside already-authorized standing goals. No new permission is inferred from an event, schedule, or model proposal.

## Acceptance tests added

- Wake target isolation, cold re-composition, idle completion and cleanup on failure.
- Weekly wall-clock time across DST.
- Monthly day-31 restoration across a short month and process restart.
- Missed monthly work with `catchUp: skip`.
- No duplicate Phoenix-managed standing objective after repeated creation, without blocking explicit user duplicate reminders.

## Limitations

- The Host must be running or relaunched for time/event triggers to execute. A Windows service/task or a remote always-on worker is needed when the UI and local process are not running, and a remote worker is needed when the PC is off.
- Background work still requires a resumable session and the configured provider to be available. Incoming connector events require an operational authenticated ingress.
- This change does not add broad unprompted web/email surveillance, unlimited tool privileges, arbitrary cron syntax, or permission-free external writes.
- Full build, Windows launch and live OAuth/provider E2E need to pass independently before declaring production readiness.
