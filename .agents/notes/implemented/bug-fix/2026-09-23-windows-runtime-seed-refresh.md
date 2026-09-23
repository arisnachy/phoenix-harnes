# Agent Note: Windows runtime seed refresh

Status: implemented

English | [中文](2026-09-23-windows-runtime-seed-refresh.zh.md)

## Problem

The desktop runtime marker can say `ready` even when the installed runtime came from an older installer seed and lacks packages required by the current desktop.

## Decision

`DesktopRuntimeSeedInstaller` compares the commit in the bundled `.phoenix-managed-install` marker with the installed runtime marker. A matching ready runtime launches immediately. A mismatch extracts the new seed to a staging directory before replacing the runtime. The old runtime moves to a uniquely named sibling directory and remains available for recovery of local self-modifications. When an installer has no bundled seed, an existing ready runtime remains usable.

The desktop performs a required refresh on a worker thread before launching the managed host and keeps the native window responsive while the new seed is installed.

## Alternatives considered

**Trust `state=ready` without comparing seed identity.** Rejected because that marker does not identify which runtime seed the installer supplied.

**Delete the replaced runtime immediately.** Rejected because a user's managed runtime may contain local self-modifications that are not present in the packaged seed.

## Consequences

An installer upgrade repairs a runtime whose seed commit differs from the bundled seed, and a ready runtime with the same seed still launches without extraction. Retained runtime directories preserve local changes but use disk space until the user removes them.
