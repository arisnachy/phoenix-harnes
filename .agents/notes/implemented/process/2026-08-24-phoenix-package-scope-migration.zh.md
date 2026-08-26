# Agent Note: PHOENIX 包作用域迁移清单

Status: implemented

[English](2026-08-24-phoenix-package-scope-migration.md) | 中文

## 问题

PHOENIX 的 workspace 与 vendored 包目前仍沿用继承的 `@deepseek-ai/*` npm 命名空间。若直接在 `main` 上改包身份，会同时影响 manifest、import、Cordis 客户端模块 id、生成的 Typert 引用、peer dependency、workspace lockfile 与构建产物。部分迁移会让运行时同时解析旧 scope 与新 scope，从而产生不一致。

## 决策

新增一个只读迁移规划器。它扫描 Git 跟踪的 `package.json`，列出所有名称以 `@deepseek-ai/` 开头的包，并推导对应的 `@phoenix-ai/` 目标名称。如果两个旧包映射到同一个目标，或 workspace 中已经存在目标名称，规划器会失败。它不会修改包 manifest、import、生成文件或 lockfile。

因此第一阶段只做观察与校验，可以安全进入 `main`。后续真正的重命名批次必须以这份清单作为包身份来源，并在同一个一致变更中重新生成 lockfile 与构建产物。

## 考虑过的替代方案

我们拒绝了直接搜索替换式重命名，因为它会让 manifest、生成产物和 lockfile 中的包身份混杂。完全推迟清单工作也被拒绝，因为后续重命名批次需要确定性的冲突检查。

## 结果

`pnpm run phoenix:scope:plan` 输出完整的旧 scope 到 PHOENIX scope 映射。`pnpm run phoenix:scope:check` 执行冲突和一致性检查且不修改仓库。在经过验证的重命名批次执行之前，当前运行时仍继续使用 `@deepseek-ai/*`。
