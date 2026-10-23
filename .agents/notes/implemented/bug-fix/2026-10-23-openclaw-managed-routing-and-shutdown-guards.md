# Agent Note: Managed OpenClaw routing and shutdown guards

Status: implemented

English | [中文](2026-10-23-openclaw-managed-routing-and-shutdown-guards.zh.md)

## Problem

Phoenix treated a provider-scoped Codex runtime as absent, read its managed OpenClaw configuration from the default user home even when the launcher selected another DSH_HOME, and did not consistently defer direct gateway start or stop during an explicitly reported live Team execution. A Cordis plugin configuration could also purport to provide its own attestation instead of obtaining execution authority from the Host.

## Decision

The managed descriptor accepts an explicit model-scoped Codex runtime or the official provider-scoped `models.providers.openai.agentRuntime.id`, with model policy taking precedence. A configured plugin allowlist must include `codex`; DSH_HOME selects the same isolated configuration path as the installer. Plugin settings may tune bounded transport timeouts but cannot supply a native route or policy attester in place of a live trusted Host service. Gateway start and stop both defer when the supplied Phoenix execution status is live, dispatching or uncertain, without changing the active marker.

## Consequences

The regression tests cover the provider-scoped route, explicit non-Codex override, excluded Codex plugin, customized DSH_HOME, and busy gateway start/stop with no process calls. These are local correctness and safety improvements, not certification of an authenticated official Gateway run. The managed Host policy provider, comprehensive idle inspection of persisted Team and legacy sessions across processes, Codex plugin activation and native model-backed acceptance remain unverified; without those, production OpenClaw execution continues to fail closed.

## Alternatives considered

**Assume model-level runtime configuration is mandatory.** Official OpenClaw supports provider-level runtime selection, so this would reject valid deployments.

**Trust user-authored policy objects or the prospective `tools.effective` preview.** The preview is not the exact run authority and an untrusted configuration cannot attest its own permissions.

**Treat a missing execution snapshot as proof of global idle.** Absence of a report does not establish that all Phoenix processes, persisted executions and other agents are quiescent; the Host-wide admission fence remains a separate release requirement.
