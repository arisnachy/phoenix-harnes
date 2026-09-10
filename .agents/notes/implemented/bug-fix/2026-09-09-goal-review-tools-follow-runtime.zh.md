# Agent Note: Goal review tools follow the assembled runtime

Status: implemented

[English](2026-09-09-goal-review-tools-follow-runtime.md) | 中文

## Problem

Adversarial completion tester 和 final goal judge 请求固定的 preferred tool list。只挂载较少 tools 的 profile 会在 child 生成 structured verification evidence 前拒绝该 child，因此 goal completion 虽然存在于 source 中，却没有连接到这些 assembled runtimes。

## Decision

`availableReviewTools()` 读取 parent agent 对 model 可见的 tool schemas，并与每个 review stage 的 preferred tools 取交集。Adversarial execution child 与 final judge 只接收 assembled parent runtime 实际公开的 tools。Preferred ordering 保持稳定，也不会虚构不存在的 capability。

Completion requirements 保持不变。缺少 capability 可能降低 reviewer 能收集的 evidence，但不会绕过 six completion checks、evidence ledger、artifact fingerprint、clean-room evidence 或 final judge verdict。

## Alternatives considered

**保留固定 preferred list：**拒绝，因为有效的 minimal assembly 无法解析未挂载的 tools。

**把所有 review tools 加入每个 profile：**拒绝，因为这会覆盖 profile composition，并在 operator 未选择时扩大 capabilities。

## Verification

Focused goal 与 normalization tests 共通过 92 个 tests。Assembled ACP goal scenario 现在会创建三个真实 review children，持久化其 parent relationship，记录 six-check completion gate 与 final judge pass，完成 goal，并交付 closing message。完整 keyless snapshot suite 通过 122 个 tests，另有 8 个 intentional skips。

## Consequences

Minimal 和 provider-specific profiles 可以执行 independent goal review，而不会在 tool restriction 阶段失败。Rich profiles 仍公开完整 preferred review set。Evidence 不足的 profile 仍无法通过现有 completion requirements。
