# Agent Note: Codex 侧栏配额 seat

Status: implemented

[English](2026-08-29-codex-quota-sidebar-seat.md) | 中文

## 问题

配额 seat 之前受当前模型路由限制。用户即使拥有有效的 OpenAI/Codex 账户，也无法在使用其他路由时在 Settings 旁看到五小时或每周用量。

## 决策

seat 只从 authorization catalog 读取经过清理的 OpenAI/Codex 账户 telemetry。它独立于所选模型提供方，以有界间隔刷新，并且只显示提供方报告的有限百分比。缺少或无效 telemetry 时不创建 seat，也不估算数值。

## 后果

模型路由切换时账户限制仍然可见。组件不会暴露凭据、原始 authorization payload 或根据 token 推导的估计值。真实的五小时或七天数值仍然需要 authorization provider 发布对应窗口。

## 考虑过的替代方案

- **让 seat 受当前模型路由限制。** 否决，因为选择其他提供方时 OpenAI/Codex 账户限制仍然有用。
- **用本地 token 计数估算缺少的窗口。** 否决，因为本地计数不是提供方权威的配额 telemetry。
