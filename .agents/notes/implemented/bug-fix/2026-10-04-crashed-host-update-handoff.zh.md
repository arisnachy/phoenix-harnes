# Agent Note: Host 崩溃时的 stable 更新交接

Status: implemented

## Problem

Windows supervisor 原本把 stable updater 绑定到每一次 Host 生命周期。Host 在启动阶段崩溃时，supervisor 会立即停止该 updater，并在一秒后重新启动同一个损坏的 Host。如果此时已有新的 stable 版本，updater 虽然能够重置持久 staging worktree 并打印“preparing stable”，却会在依赖刷新、构建和 smoke 完成之前被杀掉。由于 Host 从未启动到可以运行 restart bridge 的阶段，supervisor 会无限重复“准备 / 崩溃 / 杀 updater”的循环。

这意味着恰恰在需要仓库修复的损坏状态下，Phoenix 无法自动接收到修复版本。

## Decision

当 Host 意外退出且 updater 状态仍为 `preparing` 时，supervisor 不再立即停止已经运行的 updater，而是让它继续完成准备。默认最多等待五分钟，可通过 `PHOENIX_CRASH_UPDATE_RECOVERY_WAIT_MS` 调整。如果准备成功并产生已验证的 prepared marker，supervisor 会停止 watcher，把目标版本激活到已验证的 isolated runtime，继续使用现有的 build / smoke / boot-preflight 流程，通过该 runtime 重新修复 profile fallback，然后重新启动 Phoenix，而不再等待 Host 内部的 restart bridge。

如果 updater 进入 error / paused / off，或等待超时，则恢复原有崩溃恢复流程。如果 isolated activation 失败，只清理一次性更新控制 marker 并写入恢复报告，不触碰用户数据。

## Alternatives considered

**继续重启 Host 并依赖它的 bridge。** 当插件加载在 Host 启动完成前就失败时，bridge 根本没有机会运行，因此会形成死锁。

**把 updater 永久改成 supervisor 全局进程。** 这是更大的生命周期重构。当前方案保留现有所有权语义，只在 updater 已经正在准备修复时让这一实例跨过 Host 崩溃继续运行。

**把缺失包直接复制进 `.dsh`.** Profile fallback 的设计就是轻量 junction farm。重新复制包树会带回旧代码问题和之前 `.dsh` 膨胀到数十 GB 的问题。

## Consequences

损坏的 Host 现在可以真正接收到修复它的 stable 版本。当 stable candidate 正在构建时，控制台不会每秒重新启动同一个失败 Host；准备完成后会直接切换到已验证的 isolated runtime。没有更新正在准备的普通崩溃仍保持原来的一秒重启行为。
