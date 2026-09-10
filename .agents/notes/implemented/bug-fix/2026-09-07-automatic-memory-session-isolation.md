# Agent Note: Automatic memory session isolation

Status: implemented

English | [中文](2026-09-07-automatic-memory-session-isolation.zh.md)

## Problem

Automatic prompt assembly reads the shared legacy ledger without a session filter. Unrelated projects can therefore contribute memories to the same model request. Directory basenames and the most recently created session do not identify the project requesting context.

## Decision

The consumer passes the assembling agent's session to `recallForSession()`. The service admits the requesting session and loaded sessions with the same normalized absolute workspace path, then applies the result limit. Missing or relative workspace paths admit only the requesting session. Diagnostics without an agent receive no automatic memories. Explicit cognitive search remains a separate operation.

## Verification

Service regressions distinguish two projects with the same directory basename, retain continuity between sessions in one directory, isolate projectless sessions and apply the result cap after filtering. Consumer checks assemble context for an actual agent and reject memory injection into diagnostics. A real Loader snapshot passes in source and built modes, checking model requests and persisted context with only the external model adapter simulated.

## Alternatives considered

- Filter by directory basename: unrelated paths can share a name.
- Use the newest global session: concurrent requests can belong to different projects.
- Query the full cognitive index during every assembly: changes retrieval cost and does not establish the requesting session.

## Consequences

Historical memories whose session headers are unavailable are omitted from automatic recall. Path aliases and differently cased paths remain separate. No stored records are deleted, and this change does not grant memories authority over permissions or tools. Explicit cognitive search defaults and historical project identifiers require their own review.
