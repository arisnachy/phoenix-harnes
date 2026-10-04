# Agent Note: Stable update activation while the Host is crashed

English | [中文](2026-10-04-crashed-host-update-handoff.zh.md)

Status: implemented

## Problem

The Windows supervisor now keeps the stable updater alive across Host crashes, so a candidate can finish dependency refresh, build, and smoke even when the current Host cannot boot. One deadlock remained: activation still depended on the Host-side restart bridge. A failure such as a missing profile runtime module can happen before that bridge ever starts, so the updater reaches a verified prepared state while the supervisor continues relaunching the same broken Host and nobody requests activation.

That is the exact failure mode in which a fixed stable version exists and has been prepared, but the broken version cannot hand control to it.

## Decision

After an unexpected Host exit, the supervisor inspects the durable updater state. If a stable update is already `preparing`, Phoenix stays down briefly instead of relaunching the broken Host every second. The supervisor waits up to five minutes by default (configurable with `PHOENIX_CRASH_UPDATE_RECOVERY_WAIT_MS`) for the verified prepared marker.

When the prepared candidate appears, the external supervisor stops the watcher and activates that target itself through the existing isolated-runtime path. That path still performs dependency installation, full build when required, launcher smoke test, boot preflight, and profile fallback healing before the new Host is started. No Host-side restart bridge is required for this recovery path.

If the updater reports error/paused/off or the wait expires, ordinary crash recovery resumes. A failed isolated activation clears only disposable update-control markers and records a recovery report; user state remains untouched.

## Alternatives considered

**Only keep the updater alive across Host crashes.** That allows preparation to finish but does not solve activation when the Host dies before its bridge is mounted.

**Keep relaunching the broken Host while preparation continues.** This creates noisy repeated failures and wastes CPU; it also leaves activation dependent on code that cannot start.

**Copy missing packages into `.dsh`.** The profile fallback is intentionally a lightweight junction farm. Copying package trees back into user storage would reintroduce stale code and the previous multi-gigabyte `.dsh` growth problem.

## Consequences

A Host that cannot complete plugin loading can now receive and activate the stable version that repairs it. During an in-progress repair, the console waits for the verified candidate rather than hammering the failed Host; once ready, Phoenix switches to the isolated verified runtime automatically. Normal crashes with no update preparation continue to use the existing one-second relaunch behavior.
