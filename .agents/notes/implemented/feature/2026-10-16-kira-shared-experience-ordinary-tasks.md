# Agent Note: Recover ordinary task experience and team procedures

Status: implemented

English | [中文](2026-10-16-kira-shared-experience-ordinary-tasks.zh.md)

## Problem

Phoenix already had durable experience metrics, shared child token attribution, procedural teaching, automatic validated-procedure recall, and quality-preserving habit promotion. However, the experience aggregator persisted ordinary work only on a durable `goal/change:complete`, while most non-Goal chat tasks ended through `turn/end`. Failures in those tasks, site-specific tool mistakes, and team member tool sequences could therefore disappear rather than inform future attempts. Automatic procedural recall also used a global last-task pointer, which could leak an unrelated task into a concurrent chat.

## Decision

- Ordinary human-owned turns with tool activity now persist bounded, **unverified** performance observations. A failed/aborted turn increases diagnostic failure counts; a completed ordinary turn is still unverified, never successful by assumption. Tool-free chatter produces no experience record.
- Records contain end-to-end elapsed time, token and tool counts, retries, human interventions, and sanitized failed tool **names**, never tool arguments or form values. The persistent reader accepts the version-1 shape with optional, bounded failed names and false verification bits.
- An ordinary non-Goal task stores its observed argument-free tool trace as a procedural **candidate** only. A durable Goal with verified completion retains exclusive authority to promote an active procedure or verified habit.
- Child-agent tool calls and strategy decisions are credited to the lead procedure, just like their resource use; child completions cannot close the lead. All automatic task-context lookups select the active agent's owning session rather than another chat's last prompt.
- Matching a similar unverified attempt produces a bounded diagnostic warning: avoid the previously failed operations and verify fresh state. No extra model call or background self-improvement job is triggered solely by the learning event.

## Alternatives considered

**Treat a normal model turn completion as task success.** This would reward fabricated claims and potentially promote failed form submissions, creating a dangerous positive feedback loop.

**Store complete browser/terminal arguments to replay.** This captures more detail but can retain passwords, personal answers, tokens, or stale selectors; only bounded operation names and approved, verified general procedures are retained.

**Replan from scratch after each task.** This ignores already verified procedures and wastes time/tokens. Bounded, task-scoped automatic memory is cheaper.

## Consequences

Kira can recognize recurrent work and retain where prior attempts failed across restarts, including ordinary non-Goal work; her team contributes to shared procedural evidence. Unverified history is explicitly quarantined from successful-habit promotion. The learner does not autonomously explore all pages on a third-party site, invent survey responses, bypass CAPTCHA/login, or change its own permissions. End-to-end speed still requires real Windows/browser benchmarks and regression tests.

## Testing

Experience tests cover incomplete/blocked tasks, failure-name preservation, true verified promotion afterward, and no learning of tool-free chat. Habit tests cover unverified recall as diagnostic only. CI checks TypeScript and the repository's suite; real-page trials validate actual latency and quality.
