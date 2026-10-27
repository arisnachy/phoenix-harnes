# Agent Note: Preserve live Codex models and updater availability

Status: implemented

English | [中文](2026-10-26-codex-live-model-catalog-and-updater.zh.md)

## Problem

The Eclipse model selector collapsed the authenticated Codex catalog to the highest GPT generation and family revision. Account-visible older and newly introduced model variants disappeared even though Codex still advertised them. Separately, a packaged Phoenix Host without a Git working directory could skip its Codex CLI update watcher despite having an explicit installation root.

## Decision

The authenticated Codex app-server remains authoritative for model availability and reasoning capabilities. Eclipse preserves every account-visible model ID in Codex order, removes duplicate IDs and the virtual Phoenix auto route, and does not infer retirement from model names. Eclipse Settings queries the authenticated Codex app-server directly using `llm.discoverModels` rather than the adapter-backed `llm.models` registry, which may contain pinned or last-good entries. The discovery RPC preserves advertised reasoning efforts and surfaces errors instead of silently substituting a stale list. A model selected from this live catalog can execute even when a saved Codex provider model list predates it: configured entries retain their precedence and overrides, while newly account-visible IDs are appended to the effective dispatch profile without mutating persisted preferences. A selected model is still validated against its actual advertised reasoning capabilities before settings are saved.

The Codex updater starts from PHOENIX_INSTALL_ROOT even when Git root detection fails, checks the official stable npm version at 30-minute intervals, and stages, smoke-tests, and activates verified upgrades. Explicit --apply works in notify mode, whereas the unattended watcher installs only in auto mode.

This supersedes the generation-pruning decision in [Eclipse coordinator and subagent routing](2026-10-21-eclipse-two-role-routing.md), without changing the coordinator or delegate routing policy.

## Alternatives considered

Hardcoded model IDs or newest-only filtering cannot represent account-specific availability. Updating the npm package alone cannot reveal models added server-side. Querying a language model to determine the catalog would increase token usage without being authoritative. Ignoring Git failures entirely would also disable source-update safety checks; only the explicit install root bypasses Git root discovery for watcher startup.

## Consequences

Eclipse can list older and future models without a Phoenix release whenever Codex advertises them. Account and feature availability still depend on the authenticated CLI's model/list result; the ChatGPT web picker is not a guaranteed equivalent. The update worker performs small periodic npm metadata checks but no LLM requests. Regression tests cover multi-generation choices, UI refresh, watcher startup, and manual-update dispatch. Real Windows installation and GitHub CI remain separate deployment checks.
