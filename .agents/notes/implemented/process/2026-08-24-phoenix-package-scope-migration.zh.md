# Agent Note: PHOENIX 包作用域迁移清单

Status: implemented

[English](2026-08-24-phoenix-package-scope-migration.md) | 中文

## 问题

PHOENIX 的 workspace 与 vendored 包目前仍沿用继承的 `@deepseek-ai/*` npm 命名空间。若直接在 `main` 上改包身份，会同时影响 manifest、import、Cordis 客户端模块 id、生成的 Typert 引用、peer dependency、workspace lockfile 与构建产物。部分迁移会让运行时同时解析旧 scope 与新 scope，从而产生不一致。

## 决策

新增一个只读迁移规划器。它扫描 Git 跟踪的 `package.json`，列出所有名称以 `@deepseek-ai/` 开头的包，并推导对应的 `@phoenix-ai/` 目标名称。如果两个旧包映射到同一个目标，或 workspace 中已经存在目标名称，规划器会失败。它不会修改包 manifest、import、生成文件或 lockfile。

因此第一阶段只做观察与校验，可以安全进入 `main`。后续真正的重命名批次必须以这份清单作为包身份来源，并在同一个一致变更中重新生成 lockfile 与构建产物。

## 备选方案

- 在一次变更中重命名所有包和 import。由于部分失败会让 manifest、生成引用、lockfile 与运行时解析处于混合命名空间，因此否决。
- 分批只改 manifest。由于包身份是整个依赖图的不变量，只更新一部分包会让 peer 与 workspace 解析变得含糊，因此否决。
- 把规划器保留为未跟踪的一次性脚本。由于真正重命名前必须能够重复生成并审查迁移清单，因此否决。

## 结果

`node scripts/plan-phoenix-scope-migration.mjs` 输出完整的旧 scope 到 PHOENIX scope 映射。`node scripts/plan-phoenix-scope-migration.mjs --check` 执行冲突和一致性检查且不修改仓库。在经过验证的重命名批次执行之前，当前运行时仍继续使用 `@deepseek-ai/*`。
