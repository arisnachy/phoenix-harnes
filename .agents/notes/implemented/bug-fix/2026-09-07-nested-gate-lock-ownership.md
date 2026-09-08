# Agent Note: Nested gate lock ownership

Status: implemented

English | [中文](2026-09-07-nested-gate-lock-ownership.zh.md)

## Problem

The consumer aggregate launches other gate aggregates while holding the checkout lock. Reacquiring that lock in a child waits for a parent that is waiting for the child, delaying validation until the lock timeout.

## Decision

Lock creation, borrower admission, owner release and stale recovery serialize through short `BEGIN IMMEDIATE` transactions in a persistent local SQLite mutex file. Closing the connection releases the operating-system lock, including after process death. A process-local FIFO prevents acquisition polling from starving release. The mutex file is not removed during normal release: replacing it could split concurrent processes across different filesystem locks.

The gate runner passes its random ownership token to child processes. A nested aggregate creates an atomic `.phoenix-gates.lock.borrower-*` lease before confirming that its inherited token still names the current checkout record. Borrowed handles remove only their own lease. Recovery of a dead owner removes dead leases but keeps the lock while a matching borrower PID remains alive, so an orphaned child cannot overlap a new aggregate. The outer aggregate waits for borrower leases before releasing its record, and the scheduler dependency graph controls ordering inside the aggregate.

## Verification

The worktree lock tests exercise a real child through the gate executor, retain the parent record after child release, reject tokens from other checkouts, exclude unrelated aggregates, replace dead ownership, and reproduce a crashed parent with a live borrower. Three synchronized processes compete to recover one stale record and assert that no contender deletes a replacement owner. The crash fixture owns and awaits every child process. The scheduler tests retain dependency and subprocess failure coverage and verify token propagation into child environments.

## Alternatives considered

- Disable locking in CI: permits independent commands to modify the same build artifacts.
- Increase the timeout: lengthens the parent-child deadlock without resolving it.
- Trust an inherited Boolean: bypasses checkout ownership without checking its current record.
- Keep only the parent PID in the record: lets a live orphaned borrower overlap a replacement aggregate after the parent exits.
- Delete stale records after an unlocked read: competing recoverers can remove a newer owner's record.

## Consequences

Nested gates share aggregate ownership rather than gaining independent mutation authority. Borrower leases are transient files beside the lock and are cleaned when their process exits or releases. The token coordinates cooperative local build processes; it is not a security boundary against processes that can read the checkout. Existing explicit lock disabling remains unchanged.

The mutex uses Node's built-in SQLite support, already required by repository storage tests, and adds no package dependency. It coordinates a local checkout on one host; concurrent use of different gate-runner versions or external deletion of mutex files is outside this guarantee.
