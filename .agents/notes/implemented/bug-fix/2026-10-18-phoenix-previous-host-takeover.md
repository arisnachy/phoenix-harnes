# Agent Note: Previous Windows Phoenix Host takeover

Status: implemented

English | [中文](2026-10-18-phoenix-previous-host-takeover.zh.md)

## Problem

Prior startup could not retire an existing Host supervised from a detached `phoenix-runtime-*` directory or from the same official checkout, because the older handoff implementation required a different older official Git checkout.

## Decision

The update now recognizes the durable root and runtime namespace derived from the checkout Git common-dir hash. It preserves owner, command-line, TCP listener, supervisor and PID creation-time checks. A recognized associated installed Phoenix.exe shell is closed before retiring its Host. Other applications retain their ports.

## Consequences

Takeover remains constrained by Host owner, command-line and PID checks.

## Alternatives considered

Stop any application on the Phoenix port. Rejected because other applications must retain their listeners.
