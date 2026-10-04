# Agent Note: Host 崩溃时激活 stable 更新

[English](2026-10-04-crashed-host-update-handoff.md) | 中文

Status: implemented

## Problem

Windows supervisor 现在已经会让 stable updater 跨越 Host 崩溃继续运行，因此即使当前 Host 无法启动，candidate 也能完成依赖刷新、构建和 smoke。仍然存在一个死锁：激活依旧依赖 Host 内部的 restart bridge。像 profile runtime 模块缺失这样的故障会发生在 bridge 启动之前，因此 updater 虽然已经得到经过验证的 prepared 状态，supervisor 却仍不断重新启动同一个损坏 Host，而且没有任何进程提出激活请求。

这正是“修复版 stable 已存在且已经准备完成，但损坏版本无法把控制权交给它”的故障模式。

## Decision

Host 意外退出后，supervisor 会读取持久 updater 状态。如果 stable 更新已经处于 `preparing`，Phoenix 会暂时保持停止，而不是每秒重新启动损坏的 Host。默认最多等待五分钟，可通过 `PHOENIX_CRASH_UPDATE_RECOVERY_WAIT_MS` 调整，以等待经过验证的 prepared marker。

Prepared candidate 出现后，外部 supervisor 会停止 watcher，并通过现有 isolated-runtime 路径直接激活该目标版本。该路径仍会在启动新 Host 前执行依赖安装、需要时的完整构建、launcher smoke test、boot preflight 和 profile fallback 修复。这个恢复路径不再需要 Host 内部的 restart bridge。

如果 updater 进入 error / paused / off，或等待超时，则恢复原有崩溃恢复流程。如果 isolated activation 失败，只清理一次性更新控制 marker 并记录恢复报告，不触碰用户数据。

## Alternatives considered

**只让 updater 跨 Host 崩溃继续运行。** 这样 preparation 能完成，但 Host 在 bridge 挂载前已经死亡时，仍然没有激活者。

**在 preparation 继续时不断重启损坏 Host。** 这会产生大量重复错误并浪费 CPU，同时仍依赖无法启动的 bridge。

**把缺失包复制进 `.dsh`.** Profile fallback 的设计是轻量 junction farm。复制包树会重新引入旧代码以及此前 `.dsh` 膨胀到数十 GB 的问题。

## Consequences

无法完成插件加载的 Host 现在可以真正接收并激活修复它的 stable 版本。修复正在准备时，控制台会等待经过验证的 candidate，而不是持续轰炸失败的 Host；准备完成后 Phoenix 会自动切换到 verified isolated runtime。没有更新正在准备的普通崩溃仍保持原有一秒重启行为。
