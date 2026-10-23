# Agent Note: Managed OpenClaw Host runtime authority

Status: implemented

English | [中文](2026-10-23-openclaw-host-runtime-authority.zh.md)

## Problem

The OpenClaw plugin expected `openclawManagedRuntime` but no shipped Host registered that service, leaving native execution disconnected. Reading `openclaw.json`, trusting a saved PID, or accepting a Gateway tools preview alone cannot demonstrate process ownership or authority over a user's Lead session.

## Decision

The base composition loads a Host-only Cordis service before its OpenClaw execution adapter. The launcher manager attests an in-process owned child, matching active PID/port, verified runtime candidate, Windows TCP listener ownership, authenticated Gateway health, and the exact configuration digest. The service confines the active route to authenticated loopback OpenClaw with an exact Codex agent, restrictive read-only sandbox and tool allowlist, and live Agent Teams session ownership. It repeats Host checks before reservations, native execution and recovery, and does not adopt orphaned processes.

## Consequences

The adapter remains disconnected unless an official Gateway was started and retained by the same Host manager and has the exact expected configuration. Restarting into another process cannot inherit an in-memory execution permission. This change does not automate a restart or perform write-capable operations without verified global quiescence and native approval enforcement. An installed-Gateway Windows acceptance test is required before production release.

## Alternatives considered

Trusting the persisted marker or a reachable WebSocket was rejected because stale PIDs and unrelated loopback services can impersonate readiness. Adopting an existing unknown Gateway process was rejected because it bypasses ownership. Reporting the `tools.effective` preview as actual runtime authorization was rejected because it does not enforce a native tool call.
