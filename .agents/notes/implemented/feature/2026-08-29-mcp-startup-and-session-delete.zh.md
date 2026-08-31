# Agent Note: MCP 启动韧性与物理会话删除

[English](2026-08-29-mcp-startup-and-session-delete.md) | 中文

Status: implemented

## Problem

可选 MCP 连接器可能在启动时等待外部 npm 或认证工作，使浏览器无法访问可用主机。Phoenix 也缺少物理会话删除路径，导致 UI 删除的行仍可从持久化后端恢复。

## Decision

Phoenix 现在使用 `startupTimeoutMs`（默认 5 秒）限制可选 MCP 连接器的激活等待时间。非致命超时允许 Web 主机完成启动，同时连接器重试监督器在后台继续；严格启动仍会安全失败。`session.delete` 拒绝活动会话，把删除与每会话写入及准备状态串行化，删除 JSONL 目录或带级联事件的 SQLite 行，清理 Workspace 索引，并要求浏览器确认。

## Alternatives considered

**无限等待每个连接器。** 这保持严格启动，但会让单个外部服务阻止本地 Web 主机提供服务。

**只隐藏会话而不删除记录。** 这避免后端操作，但不满足物理删除要求，并让数据仍可恢复。

## Consequences

Web 启动证明仅限于观察到的本地 checkout：`127.0.0.1:3080` 在六秒间隔前后都返回 HTTP 200，HTML 引用了 `@phoenix-ai/dsh-client-modules/client.js`，且没有旧 namespace。物理删除由聚焦的 JSONL 和 Host/UI 测试覆盖。对于没有独立收据的外部 MCP 凭据或第三方服务，不作已验证声明。
