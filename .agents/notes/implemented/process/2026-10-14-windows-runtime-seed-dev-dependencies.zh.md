# Agent Note：Windows runtime seed 之后恢复开发依赖

Status: implemented

[English](2026-10-14-windows-runtime-seed-dev-dependencies.md) | 中文

## 问题

Windows desktop workflow 会先用 `pnpm deploy` 构建 production runtime seed，再运行 host、Game Studio 和 Filesystem MCP guard。该部署会让 workspace 处于 production 依赖状态，因此后续 `pnpm exec` 可能隐式重新安装，并删除 guard 所需的开发工具。

## 决策

Windows desktop job 将 `pnpm_config_verify_deps_before_run` 设为 `false`，并在 production seed 之后用 `pnpm install --frozen-lockfile --prod=false` 显式恢复 workspace。恢复步骤在 guard 开始前执行 `pnpm exec vitest --version`。workflow 回归测试检查 job 设置、步骤顺序、显式开发依赖安装和 guard 命令。

## 考虑过的替代方案

**允许 `pnpm exec` 修复 workspace。** 拒绝，因为隐式的 production 修复会删除 412 个开发依赖，使 guard 在测试运行前失败。

**修改 runtime seed 构建器。** 拒绝，因为该部署行为属于 production artifact 构建，而 workflow 可以在需要开发工具的准确位置恢复自身的测试状态。

## 后果

desktop job 在创建 production seed 后显式执行一次冻结的开发依赖安装，其余 guard 在稳定的 workspace 依赖状态下运行。命令执行期间不再触发自动依赖变更；缺少开发工具会在显式恢复步骤或版本检查中失败。

## 测试

`pnpm_config_verify_deps_before_run=false pnpm exec vitest run scripts/ci-workflow.spec.ts`
