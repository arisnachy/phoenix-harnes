# Agent Note: 在有本地修改的 checkout 中准备稳定更新而不阻塞

Status: implemented

[English](2026-09-12-dirty-checkout-update-staging.md) | 中文

## Problem

稳定 watcher 把任何本地修改都当作跳过候选准备的理由。因此，带有进行中工作的源码 checkout 会不断报告同一个可用 SHA，而运行中的 Host 和隔离 staging 路径都得不到可用的更新状态。

## Decision

即使实时 checkout 不干净，`scripts/phoenix-auto-update.mjs` 也会在持久的分离 staging worktree 中验证并构建每个稳定候选。`stagedCandidateValid()` 只检查已准备的基线和干净的 staging worktree；激活使用的 `preparedCandidateValid()` 还会增加实时 worktree 必须干净的条件。

预检后仍有本地修改时，更新器会记录 `available` 与 `phase: worktree`，保持 Host 运行，并说明必须等 checkout 干净后才能激活。在执行任何 merge、reset 或 artifact promotion 前，实时激活仍会拒绝不干净的 checkout。

## Alternatives considered

**在 staging 之前阻塞。** 已否决，因为这会把正常的本地开发变成反复出现的 watcher 阻塞，并违背更新路径的隔离预检职责。

**在不干净的 checkout 上 merge 或 reset。** 已否决，因为这可能覆盖未提交的源码、生成文件或用户创建的路径。干净 worktree 检查仍是激活条件。

## Consequences

稳定候选可以被下载、构建并执行 smoke test，而不会修改实时源码 checkout。只有实时 checkout 干净后，已准备的候选才可激活；在此之前，持久状态仅用于提示，且不会提供重启操作。

## Testing

`scripts/phoenix-update-contract.spec.ts` 覆盖不干净 checkout 上的隔离准备以及干净 checkout 的激活条件。`node scripts/phoenix-auto-update.mjs --self-test` 与 `node --check scripts/phoenix-auto-update.mjs` 均通过。
