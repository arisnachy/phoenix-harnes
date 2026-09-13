# Agent Note: 对分叉的已准备稳定目标执行受监督激活

Status: implemented

[English](2026-09-13-prepared-divergent-activation.md) | 中文

## Problem

Windows supervisor 会对每个已准备的重启都选择持久 staging activator。该 activator 要求实时 commit 必须是稳定目标的祖先，因此带有不相关发布历史的受管理安装在 staging 成功后仍会因为 `prepared target is not a fast-forward from the live checkout` 失败。

## Decision

现在，已准备的激活会在修改前分类 Git 祖先关系。快速前进目标使用 `git merge --ff-only`；较旧目标会被拒绝；不相关目标只有在官方、干净、受管理的发布 checkout 通过现有基线、分支、远程和 staging 身份检查后，才使用 `git reset --hard`。前一个 commit 会保存在更新路径要求的两个恢复引用中。

当目标发生分叉时，Windows supervisor 使用实时 activator，而不使用较旧的 staging activator。staging worktree 仍然提供已准备的候选版本和客户端 artifact 验证，实时 activator 则提供当前的激活策略。

## Alternatives considered

**让所有已准备的激活始终只允许快速前进。** 已否决，因为这与稳定更新策略相矛盾；该策略允许干净的受管理发布安装进行历史重新对齐。

**始终使用实时 activator。** 已否决，因为当较新的已准备目标更改更新辅助程序或客户端 promotion 逻辑时，staging activator 能保持兼容性。

**不检查所有权和干净状态就执行 reset。** 已否决，因为这可能丢弃开发历史或用户未提交的工作。

## Consequences

受管理安装可以完成已准备的稳定重新对齐，而不会在 supervisor 交接处失败。较旧目标、未受管理的分叉、发生变化的实时 checkout、非发布分支、不受信任的远程仓库和无效 staging 仍会被阻止。当前包含本地修改的 checkout 仍要求用户先保留或提交这些修改，然后才能激活。

## Testing

修改后的更新模块均通过 `node --check`。更新策略、已准备更新契约和 Windows supervisor 的聚焦 Vitest 测试通过，共 17 个测试。
