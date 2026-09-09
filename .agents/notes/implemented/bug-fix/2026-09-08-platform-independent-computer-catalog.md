# Agent Note: Platform-independent computer catalog

Status: implemented

English | [中文](2026-09-08-platform-independent-computer-catalog.zh.md)

## Problem

Windows-only registration made the generated tool catalog differ between developer hosts and Linux CI.

## Decision

The PowerShell package exports a pure computer-tool definition factory. Runtime registration remains Windows-only; the catalog generator explicitly registers the definition on other platforms to produce the same reference on Linux and Windows. Constructing the definition performs no desktop operation and grants no additional runtime permissions.

## Alternatives considered

Removing the computer entry on Windows would omit a supported capability. Registering it in every runtime would advertise an unavailable operation. Platform-specific generated references would make CI freshness depend on the author's host. The factory keeps documentation generation separate from runtime availability.

## Verification

A catalog test requires exactly one computer entry with its Windows limitation. Existing computer-tool tests retain execution validation. Linux generation remains subject to remote CI verification.

## Consequences

Catalog generation includes the Windows capability on every host while runtime registration retains its platform restriction.
