# Agent Note: PHOENIX-owned namespace gate

Status: implemented

English | [中文](2026-08-29-phoenix-owned-namespace-gate.md)

## Problem

仓库同时包含 Phoenix 自有包和 vendored 的上游 Cordis 包。因此，广泛搜索 `@deepseek-ai/*` 会把过时的 Phoenix 包名与合法的上游框架身份混在一起，而狭窄的一次性迁移计数也可能漏掉活动 manifest 或 profile 组合文件。

## Decision

`scripts/verify-phoenix-namespace.ts` 扫描已跟踪的活动产品文件，拒绝所有 Phoenix 自有的 `@deepseek-ai/dsh-*` 引用以及所有未分类的 `@deepseek-ai/*` 引用。它排除 vendored 源码以及冻结或历史 Agent Note。准确的 vendored Cordis、Cosmokit、Schemastery 和 Cordis plugin 包身份被列入允许清单，因为它们的包约定和源代码所有权仍然属于上游。该检查运行在共享静态 gate 中，也可以通过 `pnpm run verify-phoenix-namespace` 单独执行。

该 gate 校验包身份，而不是品牌文案或历史迁移记录。这些表面继续由各自的 provenance 和 branding 检查负责。

## Alternatives considered

- **替换每一个 `@deepseek-ai/*` 标记。** 拒绝，因为这会重新打包 vendored 框架，并破坏明确的 peer-dependency 与来源约定。
- **信任一次性批量替换计数。** 拒绝，因为它不能阻止过时的 profile、manifest 或未来新增的源代码引用再次出现。
- **扫描 vendored 源码和冻结记录。** 拒绝，因为这些文件有意保留上游身份或不可变历史，并不是活动 Phoenix 包表面。

## Consequences

活动 Phoenix 包引用旧产品 scope 时会 fail closed，而合法的上游依赖仍然保持明确且可审计。通过 gate 证明活动仓库表面已经迁移；它不声称抹除上游 provenance 或历史记录。
