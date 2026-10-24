# Agent Note: Unfinished Team mission recovery after Kira turn completion

Status: implemented

## Problem
A successful *model turn* is not proof that the user's entire mission is complete. The Team session listener closed UME and interrupted children on every Lead `turn/end: completed`, even with outstanding `todo/write` items. Its terminal `team/mission` checkpoint then fenced the Goal round driver, so Phoenix stopped after narration such as "next I will test".

## Decision
Use the latest whole checklist snapshot **since the latest genuine human request** to distinguish a finished turn from finished work. When that snapshot has pending or in-progress work, do not close UME, interrupt teammates, or accept an early "nothing left" statement. Explicit user cancellation remains terminal. On idle, the Goal driver may create an ordinary persistent Goal from the same human request **only if** there is no existing Goal and the most recent turn completed with unfinished items. Its existing serialized, durable goal/changed scheduler owns retries and quota stops; no parallel scheduler or synthetic new user authorization is added.

## Consequences
No auto-recovery for an absent checklist, a fully completed checklist, user cancellation, a closed UME mission, or an already existing Goal. This retains the existing verified completion, max-three teammates, provider-quota terminal condition, and zero-extra-work rule after true closure.

## Verification
Added regression fixtures for completed turns with unfinished todos, premature closure prose, explicit user cancellation, and rejected auto-bootstrap without a human or completed turn. Full local build and integration tests are still required to validate the actual host/runtime path.

## Alternatives considered

Treat every completed model turn as a completed mission. Rejected because an unfinished checklist would be discarded.
