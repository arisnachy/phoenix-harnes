# Agent Note: Python duplex-pipe deadlock

Status: implemented

English | [中文](2026-09-09-python-duplex-pipe-deadlock.zh.md)

## Problem

The Python runtime could stall during repeated binding calls when the host reply reader was active. Local faulthandler evidence showed the Python main thread blocked in `runtime.py` `send()`/`flush()` while the asynchronous reply reader was running. A regression with 100 alternating successful and rejected bindings and the existing `maxWallMs: 3000` budget reproduced the old arrangement's failure and passed with the repaired runtime. [Node issue #29238](https://github.com/nodejs/node/issues/29238) is context for pipe behavior only; it is not evidence that Node has the same defect.

## Decision

The runtime uses two child protocol pipes. `PROTOCOL_READ_FD = 3` carries host-to-child `boot` and `run` requests; `PROTOCOL_WRITE_FD = 4` carries child-to-host `boot-ack`, `call`, `log`, and `done` responses. Node spawns five positional pipes so stdin, stdout, stderr, fd 3, and fd 4 remain distinct. The host writes fd 3 and reads fd 4; the Python bootstrap reads fd 3 and writes fd 4. stdout and stderr remain dedicated capture streams.

The JSON-lines protocol, host-side child-frame validation and rebuilding, empty child environment, output limits, cancellation, and wall-clock budget remain in force. The existing wall-clock timer was not increased to mask the deadlock.

## Verification

The real-subprocess regression exchanges 100 successful and rejected bindings with `maxWallMs: 3000`; it passes with the two-pipe runtime. The focused Python runtime suite passes all six tests, including that regression, without increasing the original timer. A Loader-based snapshot starts the compiled provider and completes 200 binding calls through the assembled headless example. The protocol mirror checks both descriptor constants and the shared message vocabulary.

## Alternatives considered

**Keep one bidirectional protocol descriptor.** Rejected because the local failure showed synchronous `send()`/`flush()` could block while the other side was reading replies.

**Increase the wall-clock timeout.** Rejected because it changes the execution budget while leaving the pipe contention intact and can hide a deadlock.

**Treat Node issue #29238 as proof of the root cause.** Rejected because the external issue is contextual evidence only; the local faulthandler trace and the old-versus-new regression are the authority for this runtime.

## Consequences

The wire vocabulary now carries explicit descriptor direction: fd 3 is host input to the child, and fd 4 is child output to the host. Child responses remain hostile and validated by the host; host requests remain on the host-owned stream trusted by the child. A future protocol change must update the TypeScript constants, Python mirror, spawn descriptor layout, README pair, and protocol-mirror test together.
