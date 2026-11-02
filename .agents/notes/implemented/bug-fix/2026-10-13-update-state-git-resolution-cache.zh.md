# Agent Note: 更新状态读取复用 Git 目录解析

Status: implemented

[English](2026-10-13-update-state-git-resolution-cache.md) | 中文

## Problem

浏览器加载期间的真实运行时 CPU 追踪将反复执行的同步 Git 子进程归因于 `pluginInventory.updateState`。每个 RPC 在读取更新器状态前解析同一个 Git 公共目录，Git 执行时阻塞其他服务器工作。

## Decision

仅按运行时根目录和 Git 标记身份缓存解析后的控制目录。关联 worktree 的标记文件包含有界内容和元数据，因此替换或重写指针会使缓存路径失效。删除并恢复标记也会重新解析。每次调用仍读取并解析状态 JSON；重启与刷新请求保留公共控制目录。

## Alternatives considered

**缓存整个快照。** 这会掩盖更新器进度或错误。

**缓存所有服务器 bundle。** 追踪证明的阻塞操作是重复 Git 解析，而不是持续文件读取。

**重启活动运行时来诊断。** 隔离浏览器和临时回环 inspector 在不中断会话的情况下提供证据；之后已关闭 inspector。

## Consequences

[更新器状态原子写入](2026-08-30-atomic-update-state.zh.md)决策仍有效：缓存目录身份保留其新读取、原子持久化及有界重试行为。

标记稳定时，重复更新状态读取不再启动 Git。本地比较二十次预热读取，修改前为 2,755 ms，修改后为 15 ms。这是该操作的测量，不是已认证语音延迟或整页加速。首次解析和实际标记变化仍执行 Git。

## Verification

测试覆盖重复读取、新 JSON、共享 worktree 目录、标记丢失与恢复、原位指针重写，以及重启和刷新目标。发布后仍须独立验证真实应用采用情况和整页耗时。
