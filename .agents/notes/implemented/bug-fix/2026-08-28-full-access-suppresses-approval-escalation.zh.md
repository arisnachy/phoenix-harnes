# Agent Note: Full access suppresses approval escalation

Status: implemented

[English](2026-08-28-full-access-suppresses-approval-escalation.md) | 中文

## 问题

`danger-full-access` preset 选择了不受限文件模式，却仍保留 `ask` approval policy。因此，选择 Full access 的会话在工具把操作重试为 `danger-full-access` sandbox escalation 时，仍可能再次请求 approval。

## 决策

交付的 `danger-full-access` preset 将 `danger-full-access` 与 `never` approval policy 组合。host preset 表与浏览器 fixture 使用同一组合和描述。浏览器在启用 Full access 时仍要求显式风险确认；确认后，文件操作不会再创建额外的 approval wait。

## Alternatives considered

**让 Full access 保留 `ask` 并接受两次确认。** 否决：Full access 确认已经记录用户对模式的明确选择，第二个 escalation prompt 描述的是已经发生的切换。

**只隐藏浏览器 approval panel。** 否决：只在界面隐藏会让 host policy 继续保持 `ask`，其他客户端和直接 command path 仍会出现不一致行为。

## 影响

选择 Full access 现在会同时记录 `approval/policy: never` 与 `sandbox/mode: danger-full-access`；该会话中的 approval request 会 fail closed，而不会打开 approval panel。`workspace-write` 继续使用 `ask`，浏览器仍要求 Full access 风险确认。
