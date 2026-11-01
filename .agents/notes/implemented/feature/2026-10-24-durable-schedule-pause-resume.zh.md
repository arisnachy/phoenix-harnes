# Agent Note: 会话本地计划任务的持久化暂停与恢复

Status: implemented

[English](2026-10-24-durable-schedule-pause-resume.md) | 中文

## Problem

Phoenix 已有会话本地持久提醒，但只能创建、列出和删除。用户或协调者无法在不丢失原有提醒的情况下暂时阻止派发。

## Decision

沿用既有版本 1 的 `schedule/change` 事件日志，并加入严格解码的 `pause` 与 `resume` 转换。折叠状态使用互斥的 active 和 paused 集合，保持原始目标时间不变；`schedule_list` 按原始创建顺序显示两种状态。运行时只派发 active 记录，恢复过期记录后按逾期处理。删除允许活动或暂停状态。每个 Agent 的串行事务和持久化屏障保护管理操作。

## Alternatives considered

**只在浏览器本地记录暂停。** 否决，因为进程重启会丢失状态，但 Host 仍可能派发。

**恢复时删除并重新创建。** 否决，因为会改变身份和时间语义，也可能与派发发生竞态。

## Consequences

加载 Schedule 插件后创建的根 Agent 获得五个工具。本次改动不提供冷会话唤醒、全局任务列表、外部通知，也不恢复供应商额度耗尽的任务；这些能力需要独立的 Host 权限与调度设计。

## Testing

测试覆盖严格解码、状态转换、工具调用、持久化不确定性及插件装载和卸载。合并前仍需工作区类型检查、生成目录、快照、CI 与 Windows 验证。
