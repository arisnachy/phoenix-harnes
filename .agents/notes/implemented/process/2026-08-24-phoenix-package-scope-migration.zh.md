# Agent Note: PHOENIX 包作用域迁移清单

Status: implemented

[English](2026-08-24-phoenix-package-scope-migration.md) | 中文

## 问题

PHOENIX 继承了 `@phoenix-ai/*` npm 命名空间。重命名包身份会同时影响 manifest、import、Cordis 客户端模块 id、生成的 Typert 引用、peer dependency、workspace lockfile 与构建产物。部分迁移会让运行时同时解析新旧身份。

## 决策

将 PHOENIX 自有包族在一个 workspace 机械批次中重命名为 `@phoenix-ai/*`，然后重新安装并生成派生 catalog。保留 `@phoenix-ai/cordis`、`@phoenix-ai/cosmokit`、`@phoenix-ai/schemastery` 与 vendored Cordis 插件名称作为 upstream 身份。该批次只存在于功能分支；通过发布门禁前不修改 `main` 或 `stable`。

## 考虑过的替代方案

我们拒绝了逐字重命名所有 `@phoenix-ai/*` 名称，因为这会重新打包 upstream Cordis 并破坏其来源信息。也拒绝只重命名部分包，因为 manifest、生成产物和 lockfile 会出现不一致。

## 结果

当前功能分支在 archived note 之外已没有活动的 legacy DSH scope 引用，并已按新包身份重新安装 workspace。剩余的 `@phoenix-ai/*` 引用属于 upstream 依赖或历史／来源记录，不应视为 PHOENIX 污染。提升前仍必须完成完整构建与干净发布验证。
