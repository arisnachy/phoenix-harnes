# Agent Note: 原子更新状态写入

Status: implemented

[English](2026-08-30-atomic-update-state.md) | 中文

## Problem

Host 会在 updater 发布生命周期变化时轮询 `phoenix-update-state.json`。直接覆盖文件会在打开文件到完成写入之间暴露截断的 JSON。随后 Host 会报告通用更新错误，即使更新操作本身仍然正常。

## Decision

所有 updater 入口都通过 `scripts/phoenix-update-state.mjs` 持久化状态。该 helper 将完整 JSON 文档写入按进程和 UUID 隔离的同目录临时文件，再将其重命名覆盖目标文件。Host 现在也对重启请求和 `restarting` 状态使用相同的原子替换，并对短暂的 Windows 替换锁执行短重试。清理操作只删除本次调用的临时文件；Host 保留有限次数的读取重试，用于处理文件系统时序以及旧安装。

## Alternatives considered

**只增加 Host 重试次数。** 这会缩小竞争窗口，但仍可能让读取者看到不完整状态，并使结果依赖时序。

**忽略格式错误的状态。** 这会隐藏真实的持久化故障，并可能让界面显示过期的生命周期信息。

**为 updater 状态使用数据库。** 完整运行时尚未启动前，updater 只需要一个小型仓库本地文档；增加数据库会扩大启动和恢复依赖。

## Consequences

浏览器看到的始终是上一个完整状态或新的完整状态。并发 updater 进程不会共享临时文件名，短暂的 Windows 文件锁会被重试而不会隐藏持久故障。写入失败会保留原目标文件，临时同目录文件会被清理。状态文件仍是简单 JSON，并继续位于用户会话、凭据和记忆之外。已准备候选版本标记也使用相同 helper，因此准备过程不会发布不完整的 target。侧栏现在区分进行中的进度、等待重启、重连中和持久错误状态；持久错误提供安全的立即重试读取，而不会显示原始传输或 Git 细节。

## Testing

`scripts/phoenix-update-state.spec.ts` 连续写入两个状态，并验证最终 JSON 以及临时文件清理。Host 状态测试验证重启持久化以及两次原子写入的清理。updater UI 测试验证重试操作、生命周期显示、重连行为和紧凑侧栏。helper 和三个 updater 入口均通过 `node --check`。`node scripts/phoenix-auto-update.mjs --self-test` 通过。新增 UI 重试后，聚焦的 Host 与 updater UI 测试通过了 2 个文件和 43 个测试；此前四文件回归套件通过 44 个测试。
