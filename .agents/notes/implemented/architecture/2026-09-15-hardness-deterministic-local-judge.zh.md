# Agent Note：HARDNESS deterministic local mission judge

Status: implemented

[English](2026-09-15-hardness-deterministic-local-judge.md) | 中文

## Problem

HARDNESS semantic mission judge 依赖 optional subagent provider，并且在 provider 不可用时正确地保持 blocked。但没有挂载 subagent runtime 时，mission runtime 也没有任何 judge，因此即使 artifact 在机械层面完整，local 或 minimal deployment 仍无法进入 independent verification。

## Decision

adapters 暴露 `createDeterministicMissionJudge()`；当没有 semantic subagent runtime 时，production mission runner 选择这个 judge。Local judge 检查 artifact id 与 MIME、rendered artifact identity 与 kind、durable evidence，以及每个 mandatory criterion 是否处于 `TESTED` 或 `VERIFIED` 且带有非空 evidence。证据不完整时返回 `needs_changes`，绝不把缺失证据当成 pass。

挂载 subagent runtime 时，semantic `createSubagentMissionJudge()` 仍是更强的路径。Provider resolution、无效 structured output、非 completed run 与启动错误继续 fail-closed 为 `blocked`；local path 独立放在 `mission-local-judge.ts`，因此不会加载 optional semantic runtime。

## Verification

`mission-judge.spec.ts` 覆盖 local judge 的 pass 与 incomplete-evidence cases，`mission-runtime.spec.ts` 覆盖 no-subagent 时 production runner 的选择。Local judge smoke 在 `node --experimental-transform-types` 下通过。HARDNESS 与 adapters typecheck、focused test typecheck、Markdown link check、documentation budget、Agent Note classification，以及 `git diff --check` 通过。Vitest 仍在 test discovery 前受 Windows `spawn EPERM` 环境错误阻塞；direct integration test typecheck 另外暴露了 `openclaw/broker.ts` 既有的 `src`/`lib` nominal-type mismatch。

## Consequences

Minimal deployment 可以在机械 evidence 完整时完成 mission，而不需要 model subagent。Local judge 不取代 semantic provider 可用时的 semantic review，也不宣称已经完成 task-specific qualitative review。Semantic outage 仍会阻止 semantic completion，不会静默降低 review bar。

## Alternatives considered

**在没有 subagent 时继续阻塞 mission。** Rejected，因为 local deployment 需要 deterministic verification path，optional provider 的缺失不应禁用 artifact/evidence checks。

**Semantic judge 失败后回退到 local judge。** Rejected，因为 semantic failure 必须可观察并 fail closed；静默降低 review bar 可能接受需要 qualitative inspection 的 artifact。

**把 local judge 留在 semantic module。** Rejected，因为加载 local path 仍会加载 optional subagent runtime，并重现 missing-build failure。
