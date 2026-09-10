# Agent Note: Permission-separated PHOENIX upstream quarantine

Status: implemented

[English](2026-09-09-permission-separated-upstream-quarantine.md) | 中文

## Problem

计划任务和手动 upstream intake 在同一个 workflow 级写权限下合并了 public ref 解析、不可信 source 执行、branch 发布与 pull request 创建。

## Decision

`.github/workflows/phoenix-upstream-quarantine.yml` 使用 workflow 级空权限集合，并且只为每个 job 授予所需权限。

`resolve-upstream` 对 PHOENIX `stable` base、public upstream `main` ref 以及派生 candidate branch 执行匿名 `git ls-remote`。Branch 名称使用 `quarantine/phoenix-<base>-<upstream>` 同时包含两个缩短 SHA，因此新的 PHOENIX base 不会复用旧 candidate。Resolution 输出完整 commit SHA，并且从不 checkout 或写入 ref。

`validate-candidate` 使用 `permissions: {}`，不使用携带凭据的 checkout。它从两个输出的 SHA 重建 candidate，拒绝 credential 环境变量，在安装时禁用 package lifecycle scripts，并记录 merge 后的 tree identity。Workflow 使用的 actions 固定到完整 commit SHA。

Static gate 运行前，validation 从不可变 workflow commit 提取 `scripts/phoenix-quarantine-verify.mjs`。该 verifier 要求 base 拥有的所有 package scripts 和 `scripts/` 下的 executable automation files 与 base 逐字节一致。因此 candidate 无法把 acceptance command 替换成永远成功的 no-op。Automation 变更需要单独的 PHOENIX review；product source 变更继续进入 quarantine gate。

如果 upstream tree 已经存在于 PHOENIX base tree 中，validation 会记录不需要 candidate，publication 会停止而不会创建空 branch。

`publish-candidate` 是唯一拥有 `contents: write` 的 job。它从不可变 SHA 重新执行 merge，并要求其 tree 与无 credential validation 产生的 tree 完全相同。它不会 force push 或发布 tag。如果 candidate ref 已存在，只有其 tree 与已验证 tree 完全相同时 publication 才会接受它。

`open-review` 与 branch push 分开，仅拥有 `pull-requests: write`；GitHub token 会隐式提供 repository metadata access。它最多创建一个以 `stable` 为 base 的 draft review PR，并且该 PR 在任何 integration 前都需要人工 review。

source boundary 仍归 PHOENIX 所有。Codex、Claude Code 与 OpenClaw 继续通过 [Codex and OpenClaw staged upstream intake](../feature/2026-08-31-codex-openclaw-upstream-intake.zh.md) 中描述的 reviewed bridge intake 进入。

## Alternatives considered

**单个拥有写权限的 job：**拒绝，因为 candidate code 执行时会同时拥有 repository 与 pull request 写能力。

**向 publisher 传递 validation artifact：**拒绝，因为 publisher 可以根据不可变 source 与 base SHA 重建 candidate，从而避免 artifact 被替换的路径。

**使用 pull-request target workflow 进行 validation：**拒绝，因为它会把 privileged token 暴露给外部 contribution event 选择的 source。

## Consequences

Validation 仍然可以执行不可信 product 与 test code 并下载 public dependencies，但无法通过 workflow 环境访问 repository、pull request、package 或 runner artifact credentials。它的 45 分钟 timeout 会限制停滞的 candidate。受保护 automation 的变更会 fail closed 并要求显式 review。Static gate 继续作为 acceptance policy，精确 tree 比较则把该结果连接到最终发布的 branch。

## Testing

`scripts/ci-workflow.spec.ts` 会断言权限拆分、双 SHA branch identity、固定 actions、不可变 verifier、tree handoff、非 force branch push，以及独立的 pull request 权限集合。`scripts/phoenix-quarantine-verify.spec.ts` 证明 product 变更可以通过，而替换 package script 或 executable automation 会失败。组合 focused run 共通过 20 个 tests。
