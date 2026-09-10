# Agent Note: 共享记忆和 MCP 展示字段

Status: implemented

[English](2026-09-08-shared-memory-and-mcp-presentation-fields.md) | 中文

## Problem

自动记忆上下文和记忆搜索结果重复了相同的认知记录投影，stdio 与 Streamable HTTP MCP schema 也重复了相同的命名空间、超时、启动和重连字段。独立副本即使仍能通过 TypeScript，也可能逐渐产生差异。

## Decision

[`presentation.ts`](../../../../packages/session-learning/tool-session-learning/src/presentation.ts) 负责共享的、经过清理的认知记录投影。自动上下文直接使用该投影，搜索结果再增加实体、关系、状态、分数和原因；legacy 记忆记录继续使用独立投影。

[`index.ts`](../../../../packages/mcp/mcp-client/src/index.ts) 在一个私有 schema 字段对象中定义共用的 MCP 配置字段。stdio 和 Streamable HTTP schema 显式命名各共享字段，使静态目录能枚举它们，同时保留传输判别字段、传输专属字段、现有默认值和验证规则。

## Verification

记忆展示、MCP 插件生命周期和 MCP 工具桥接的定向 Vitest 覆盖已通过：3 个文件共 84 项测试。两个变更源文件的定向 Oxlint 和无输出 TypeScript 检查已通过。

## Alternatives considered

**抑制重复代码报告：**拒绝，因为 ignore 会隐藏模型可见清理逻辑和 MCP 配置验证未来产生的差异。

**保留并行副本并一起更新：**拒绝，因为这些重复字段分别属于同一个语义投影和同一条配置规则。

**将 legacy 记忆投影合并到认知 helper：**拒绝，因为 legacy 记录有意公开更少字段，必须保持现有输出。

## Consequences

共享认知字段或 MCP 默认值的变更现在各自只有一个负责实现。传输专属输出、legacy 记忆输出、清理逻辑和公开配置行为保持不变。
