# Agent Note: Kira uses scoped Code Mode for fast multi-tool work

Status: implemented

English | [中文](2026-10-16-kira-universal-code-mode-fast-execution.zh.md)

## Problem

Kira's universal tool flow used native tool calls, each requiring another model round trip before the next dependent action. The shipped `code` agent already had a tested, scoped TypeScript `run_code` presentation, but `kira-max` did not. In a sample 12-field browser form, actual browser tool time was only a few seconds compared to minutes of repeated model decisions and narration.

## Decision

The Kira Max preset now declares an agent-scoped `@phoenix-ai/dsh-agent-tool-presentation` row with `mode: code`. The existing Web host mounts `@phoenix-ai/dsh-code-runtime-worker-thread`; no runtime or registry is duplicated in the agent plane. Kira's persona specifies how to chain already-decided steps through the typed SDK in one `run_code` program, use `complete_form` for structured web forms, use DOM before desktop screenshots, parallelize only independent concurrency-safe reads, and end after sufficient verification.

The transport executes every inner tool through the existing Phoenix tool registry, preserving native permission approvals, policy guards, durable tool-dispatch logs, concurrency semantics, and cancellation. Other agent presets retain their existing presentation. The Code Mode preset already has integration tests for scoped isolation; Kira's CLI preset test now verifies its production configuration and Web runtime dependency.

## Alternatives considered

**Enable `both`**: sends native schemas and the generated SDK together, increasing prompt size and still encouraging serial model-direct calls.

**Set global `DSH_TOOLS_MODE=code`**: overrides every agent rather than just Kira, risking regressions in specialized presets.

**Write another browser/computer engine**: duplicates the already-guarded registry bridge and does not address non-browser tasks.

## Consequences

Kira can execute safe tool sequences with fewer LLM round trips in browser, file, research, and computer tasks. A `run_code` dispatch is not permission elevation; tool calls requiring human approvals still require them. Scripts must not guess selectors or silently retry external side effects. The added SDK instructions may affect prompt size; measure total token use and wall time before claiming superiority. Presets running without any `codeRuntime` must provide one, or the Kira tool-presentation row will remain unavailable by design.

## Testing

CLI preset checks assert one scoped Code Mode row, its TypeScript Web runtime dependency and explicit guidance. Existing Code Mode and per-agent presentation suites test the underlying isolation and dispatch. Real Chrome/Windows performance remains an acceptance test.
