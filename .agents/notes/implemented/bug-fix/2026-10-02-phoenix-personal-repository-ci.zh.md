# Agent Note: Phoenix 个人仓库的 CI 兼容性

Status: implemented

[English](2026-10-02-phoenix-personal-repository-ci.md) | 中文

## Problem

PR 引用本仓库 Issue 后，policy 请求原生 issue fields。Phoenix 个人仓库中该 endpoint 返回 404，但 Issue 存在且 Priority 允许为空。vendor-rescope 检查还要求当前 client-purity predicate 已不存在的行内注释与缩进。

## Decision

只有 repository API 确认所有者类型为个人 User 后，才将可选 issue-field-values endpoint 的 404 视为空字段列表。组织仓库字段不可用时仍失败。前置 Issue 查询仍必须成功；401、403 和其他服务商错误仍失败。PR kind、area、引用和已有 Priority 的校验规则保持不变。生命周期 Project 要求不变。

rescope codemod 的 exact-edit 目标与当前两行 predicate 对齐，修复断言而不改变客户端打包行为。重复或部分应用的插入仍非法。已有名称特定例外还覆盖当前 Cordis preset 测试及 visual-workspace occupant owner：裸 `cordis` 值是产品标识而非 import specifier，不能重命名。

## Alternatives considered

删除 Issue 引用会隐藏服务商不兼容。忽略所有字段错误会隐藏权限失败。禁用 rescope 校验会失去重复编辑保护。仅为文本匹配恢复旧注释会让运行时代码格式耦合陈旧工具。

## Consequences

个人仓库无需可选原生 Priority 字段即可校验引用 Issue。拥有字段的组织仓库仍校验 Priority。真实 policy CLI 使用本地 API fixture 验证 404 与 403。已有 rescope 分类测试和整个 worktree 的 rescope 检查覆盖 predicate 修复。不改变产品运行时行为。
