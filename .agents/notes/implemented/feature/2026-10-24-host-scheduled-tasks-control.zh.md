# Agent Note: 计划任务中心的 Host 权限边界

Status: implemented

[English](2026-10-24-host-scheduled-tasks-control.md) | 中文

## Problem

Phoenix 全局任务中心能够列出持久主动任务，但 Host 的 `/phoenix-tasks` 通道原来只有读取和提示操作，浏览器无法真正创建或管理任务。

## Decision

复用现有的 loopback RPC 和持久化 `ProactivityEngine`，不在浏览器新增调度器。只接受严格验证的用户聊天任务：规范的未来 UTC 时间、非空且有限长度的标题与指令、单次或至少五分钟间隔的重复任务，以及固定的 `createdBy=user`、`senderIdentity=user`、`catchUp=latest`、`delivery=chat`。拒绝额外字段和特权身份。Host 必须恰好有一个活动根会话；没有会话或有多个会话时不能猜测任务所有者。持久化引擎完成保存后才返回成功。暂停、恢复、取消仅针对用户可见任务，并在客户端通过权威列表复核状态。

## Alternatives considered

**使用浏览器 localStorage 和定时器。** 否决：关闭浏览器或重启系统后无法可靠工作。

**多个根会话时随意选择一个工作区。** 否决：可能造成跨工作区执行。

**浏览器直接创建 system 或 harness 任务。** 否决：会违反模型和 Host 的权限边界。

## Consequences

恰好有一个活动根会话时，用户可以创建和管理持久的聊天任务。没有根会话或有多个时，将返回明确错误，直到提供选择会话的界面。到期任务仍依赖 Host 启动；特权与条件任务继续走已有的授权工具。

## Testing

测试覆盖输入验证、Host 持久化、暂停恢复取消、会话所有权歧义、非法载荷以及前端对服务端确认结果的检查。提升到发布分支前仍需完整静态检查、覆盖率和 Windows 验证。
