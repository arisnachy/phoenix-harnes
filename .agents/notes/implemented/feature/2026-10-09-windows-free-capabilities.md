# Agent Note: Read-only Windows free-capability inventory

Status: implemented

English | [中文](2026-10-09-windows-free-capabilities.zh.md)

## Problem

Phoenix cannot assume that local Windows runtimes, AI APIs or accelerators are available. Treating every feature as ready risks failed actions, unapproved downloads and unintended costs.

## Decision

Phoenix exposes an opt-in, read-only JSON environment inventory with `pnpm run windows:capabilities`. It uses built-in Node and Windows PowerShell to inspect Windows build, aggregate RAM, adapter names and command presence for WinGet, WSL, Ollama, Foundry Local and PowerShell 7, with bounded execution and sanitized failure output.

Native notifications, Windows AI APIs and Microsoft Execution Containers (MXC) remain explicitly labeled as requiring an additional bridge, SDK/device verification or runtime update. MXC is not a dependency because its Node SDK requires Node 24+, while Phoenix retains Node 22 support.

## Alternatives considered

**Automatically install runtimes:** rejected because installation involves downloads, hardware limits and user consent.

**Declare all Windows 11 features enabled:** rejected because OS version and command presence cannot prove that a model, GPU/NPU or native integration is functional.

**Upgrade all of Phoenix to Node 24 for MXC:** rejected because it introduces avoidable compatibility risk before a separate adapter is validated.

## Consequences

The user can inspect available free prerequisites without changing system settings, reading credentials or slowing Phoenix startup. The output is a prerequisite snapshot, not an authorization, model benchmark, functional local inference service or completed native notification integration.

## Testing

Focused unit cases cover non-Windows skips, Windows version boundaries, tool presence, sanitized errors and hardware-data minimization. Real Windows acceptance requires running `pnpm run windows:capabilities` on the target PC.
