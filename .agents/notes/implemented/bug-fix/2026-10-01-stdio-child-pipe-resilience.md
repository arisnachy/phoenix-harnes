# Agent Note: Stdio child pipe failures stay inside their transport

Status: implemented

English | [中文](2026-10-01-stdio-child-pipe-resilience.zh.md)

## Problem

PHOENIX has two long-lived Host paths that write to short-lived child-process stdin pipes: Codex app-server model discovery and MCP stdio transports. A child can exit after spawn but before a request write or teardown completes. On Node, especially on Windows where the pipe is exposed as a Socket, that race can emit `EPIPE` or `ERR_STREAM_DESTROYED` as an `error` event on the writable stream. A write callback can report the same RPC failure while the unowned stream event still becomes an uncaught exception and terminates the entire Host. The Windows supervisor restarts PHOENIX afterward, but a transient provider timeout must not become an application crash.

The stable-update watcher can also report a transient Git connection reset in the same log window. That watcher already contains network failures and backs off without owning Host lifetime, so it is not part of the crash path.

## Decision

Codex model discovery now owns `child.stdin` error events as soon as the metadata app-server is spawned. Active JSONL writes still fail through their existing write callbacks, while teardown avoids calling `end()` on an already destroyed or ended pipe and contains the synchronous close race.

The MCP client now uses a small `StdioClientTransport` compatibility subclass. Immediately after the SDK synchronously spawns its child, PHOENIX attaches an error listener to the SDK child stdin before the MCP Client can send `initialize`. Expected `EPIPE` and `ERR_STREAM_DESTROYED` events are treated as transport closure; unexpected writable errors are forwarded through the transport's existing `onerror` callback. Protocol close/reconnect policy remains owned by the MCP SDK and PHOENIX connection supervisor.

No process-wide `uncaughtException` handler is added. Provider or connector failures remain local, observable failures instead of being hidden globally.

## Alternatives considered

**Rely only on the Windows supervisor restart.** Rejected because it recovers after user-visible interruption and can repeat indefinitely when the same short-lived child race recurs.

**Install a process-wide uncaught-exception filter for EPIPE.** Rejected because it cannot reliably distinguish these known transport races from unrelated broken pipes and would resume the Host after an exception escaped its ownership boundary.

**Increase the Codex model-refresh timeout.** Rejected because the observed Codex models-manager timeout is upstream child behavior; a longer outer timeout does not own the writable stream event and therefore does not prevent the Node Host crash.

**Treat the stable Git watcher reset as the root cause.** Rejected because watch mode already catches that fetch failure, writes retry state, and backs off. It is temporally adjacent but non-fatal.

## Consequences

A Codex catalog refresh or MCP server that exits while PHOENIX is writing can fail, close, or reconnect without terminating the Host. Codex keeps the existing last-good/static catalog behavior, and MCP keeps its bounded reconnect policy. The compatibility shim depends on the MCP SDK's current `_process` field; a focused runtime regression test pins that assumption so an SDK layout change fails CI instead of silently removing the guard.

## Testing

Package regressions exercise a synthetic Codex stdin `EPIPE` and a real spawned MCP stdio child whose stdin emits `EPIPE`. The tests assert that the writable has an error owner and that the event does not escape as an uncaught exception.
