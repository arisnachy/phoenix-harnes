# Agent Note: Proactive home attention and durable interest missions

Status: implemented

English | [中文](2026-09-29-proactive-home-attention-and-interest-missions.zh.md)

## Problem

Phoenix already persists scheduled tasks, condition watches, event-driven wake triggers, cognitive attention, background Jobs, and authorized MCP tools, but the blank-session home did not expose the useful results of that work. A user could explicitly ask Phoenix to keep learning or monitoring a subject and the runtime could execute background work, yet reopening Phoenix still looked passive unless a scheduled chat turn interrupted the conversation.

Turning that gap into a notification dashboard would make the home noisy and would duplicate the task center. The useful contract is narrower: durable user intent drives background intelligence, while the home shows only a tiny ranked projection when evidence materially deserves attention.

## Decision

An explicit ongoing objective can become one durable recurring `phoenix_task_create` task with `delivery: work`. The proactivity protocol distinguishes standing intent from casual mentions, prefers an event-driven wake trigger when a connected source can emit the relevant event, and uses already-authorized MCP/connectors during background execution. A standing interest grants permission to analyze and monitor; it does not grant standing permission for transactions, wagers, trades, messages, bookings, transfers, or other external writes.

Recurring work receives its recent summaries in the execution prompt. When no material fact changed, the worker returns the exact sentinel `NO_MATERIAL_UPDATE`; otherwise it returns concise actionable copy suitable for the home surface. Task metadata can opt the home projection into `auto`, `result`, `upcoming`, or `off`, assign a conservative relative priority, and supply short upcoming copy. These fields affect presentation only and do not alter execution, permissions, scheduling, or catch-up behavior.

The Host exposes a read-only loopback `/phoenix-tasks/attention` projection derived from already-visible task state. It excludes unrevealed surprises, suppresses unchanged recurring results, bounds result age and upcoming horizon to seven days, ranks recent failures above material background results and useful upcoming occurrences, and emits at most eight secret-free rows. Raw task instructions, credentials, connector payloads, and provider exceptions are not projected.

The Web conversation shell polls this local projection once per minute and keeps the last healthy snapshot across transport failures. The blank-session Hero renders only the top two rows as inline icon, title, separator, and muted detail beneath the greeting. It adds no card, border, badge, toast, or forced navigation; when no signal survives ranking, the Hero is identical to the quiet baseline.

## Alternatives considered

**Render a full attention dashboard on the home screen.** This would surface more state but competes visually with the composer and repeats task-center responsibility. The chosen projection keeps the home calm and makes depth an explicit drill-down concern.

**Send every background result as a chat follow-up.** This guarantees visibility but turns routine monitoring into interruptions and model turns. The home projection can surface material work without manufacturing a conversation.

**Infer permanent interests from every topic the user mentions.** This would create surprising recurring work and resource use. A durable mission requires explicit ongoing intent; ordinary questions remain ordinary questions.

**Let recurring interest tasks perform any action available to an authorized connector.** Existing connector authorization is necessary but not sufficient evidence of standing intent for consequential writes. Persistent interests remain analysis/monitoring authority only unless the task explicitly authorizes the action and normal approval still allows it.

## Consequences

Phoenix can keep explicit user interests alive across restarts, perform bounded background analysis with current authorized data, and surface only material results through the same visually quiet home that users see before a conversation begins. Scheduled class preparation and expiring one-shot obligations can appear as upcoming context, while recurring analytical missions remain invisible until they produce something useful.

The home feed is best-effort local chrome rather than a delivery guarantee. A user who needs guaranteed time/event delivery still relies on the durable task, watch, or wake-trigger mechanism itself. The one-minute browser poll trades instant visual refresh for negligible idle cost; event-driven execution remains independent of that poll.
