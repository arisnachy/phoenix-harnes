# Agent Note: PHOENIX 包作用域迁移清单

Status: implemented

[English](2026-08-24-phoenix-package-scope-migration.md) | 中文

## 问题

PHOENIX 的 workspace 与 vendored 包目前仍沿用继承的 `@deepseek-ai/*` npm 命名空间。若直接在 `main` 上改包身份，会同时影响 manifest、import、Cordis 客户端模块 id、生成的 Typert 引用、peer dependency、workspace lockfile 与构建产物。部分迁移会让运行时同时解析旧 scope 与新 scope，从而产生不一致。

## 决策

新增一个只读迁移规划器。它扫描 Git 跟踪的 `package.json`，列出所有名称以 `@deepseek-ai/` 开头的包，并推导对应的 `@phoenix-ai/` 目标名称。如果两个旧包映射到同一个目标，或 workspace 中已经存在目标名称，规划器会失败。它不会修改包 manifest、import、生成文件或 lockfile。

因此第一阶段只做观察与校验，可以安全进入 `main`。后续真正的重命名批次必须以这份清单作为包身份来源，并在同一个一致变更中重新生成 lockfile 与构建产物。

## 考虑过的替代方案

**直接在 `main` 上一次性重命名完整命名空间。** 否决，因为 manifest、import、peer dependency、生成的 Typert 引用、lockfile 与构建产物会在一次高影响范围操作中同时移动，而事前没有清单能够证明目标身份不存在冲突。

**永久保留继承的命名空间。** 否决，因为 PHOENIX 未来需要由自身拥有的包身份，并应通过一致迁移实现，而不是永久耦合到上游命名空间。

**长期同时支持两个命名空间作为别名。** 否决，因为双 scope runtime 会掩盖未完成的迁移，并可能让同一进程解析到混合包身份。迁移应作为一个经过验证的一致批次完成。

## 结果

`pnpm run phoenix:scope:plan` 输出完整的旧 scope 到 PHOENIX scope 映射。`pnpm run phoenix:scope:check` 执行冲突和一致性检查且不修改仓库。在经过验证的重命名批次执行之前，当前运行时仍继续使用 `@deepseek-ai/*`。
