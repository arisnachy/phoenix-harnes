# Agent Note: Protected PHOENIX self-evolution

Status: implemented

[English](2026-08-24-phoenix-hardness-self-evolution.md) | 中文

## Problem

PHOENIX 可以向模型提供文件系统、shell、终端与自我修改能力。如果这些能力直接写入正在执行模型的 checkout，一次未完成的组合配置、包元数据、生成产物或 runtime 代码修改就可能在模型能够诊断或修复之前破坏启动。PHOENIX 的持久数据目录同样敏感，因为 profile patch 与运行时状态会在重新安装源码后继续存在。

## Decision

Windows PHOENIX 启动器通过 `PHOENIX_RUNTIME_ROOT` 标记正在运行的 checkout，并为自我演化创建一个分离的同级 Git worktree，以 `PHOENIX_EVOLUTION_ROOT` 暴露。共享沙箱策略在该启动器事实存在时，把运行中的 runtime 与 PHOENIX 数据目录视为受保护位置。模型控制的 `danger-full-access` 会解析为 `workspace-write`；如果可写会话的 cwd 与受保护根目录重叠，会被重定向到演化 worktree。若安全 worktree 不存在或与受保护根目录重叠，自我修改会解析为只读。

模型可以在演化 worktree 中编辑、安装依赖、构建、测试并反复修正。该 worktree 不是正在运行的 runtime，并且有意保持 detached，因此激活仍是独立的受信任发布操作。受管理安装只消费已提升的 stable manifest。

stable watcher 同样把准备与激活分开。当前 PHOENIX Host 保持可用期间，被提名的 stable commit 会被获取到一个 detached staging worktree，在那里安装锁定依赖、构建候选版本并对启动器执行 smoke test。只有该 preflight 成功后，watcher 才会把阶段写入仓库拥有的 Git 状态并将 target 标记为 `ready`。Web 侧栏读取这份状态的清理后投影，在 Settings 上方显示进度，而不会修改实时 checkout。

`ready` 发布可以通过正常关闭 PHOENIX 激活，也可以通过明确的 **Restart to complete update** 操作激活。浏览器不能指定 commit：Host 只会为已经记录为 `ready` 的精确 target 接受重启请求，先持久写入请求并返回 receipt，然后才安排自身退出。detached watcher 观察到退出后，会激活同一个 target，对实时 checkout 再次构建和 smoke 验证；失败时恢复之前的 recovery ref；若是明确的重启请求，则在完成后自动重新启动 PHOENIX。

保护逻辑位于 `ctx.sandboxPolicy`，即文件系统、shell 与终端强制执行共同使用的策略归属位置，而不是依赖 prompt 或单一工具。受信任更新器与进程内持久化服务并不通过模型控制的沙箱模式取得权限，因此仍保留各自归属的写入能力。

## Alternatives considered

**允许模型直接编辑正在运行的 checkout，并依赖 Git rollback。** 否决，因为一次启动破坏可能同时移除执行 rollback 所需要的工具和服务，而持久 PHOENIX 数据目录中的修改还可能在替换 checkout 后继续存在。

**让 PHOENIX 永久只读。** 否决，因为自我演化是预期能力。隔离修改既保留该能力，也把实验与激活分开。

**只保护一份敏感文件清单。** 否决，因为敏感集合属于架构事实，会随系统演进而变化。保护完整的实时 runtime 与持久 PHOENIX 数据目录避免脆弱的 denylist，并让新增文件默认受保护。

**一检测到更新就立即应用。** 否决，因为检测不应修改正在服务当前会话的 runtime。后台准备可以在当前版本继续可用时提前暴露失败证据，而重启仍作为明确的激活边界。

## Consequences

模型可以进行破坏性或不完整修改，而不会损坏正在服务当前会话的 runtime；它可以把演化 worktree 中的构建或测试错误作为反馈继续修复。worktree 创建失败时，自我修改会降为只读，而不是获得实时 checkout 的写权限。HARDNESS 保护启动期间有意不允许模型进行不受约束的整机写入；广泛写权限仍限制在解析后的 workspace。

stable 更新可以在当前 Host 仍可使用时完成耗时的 fetch、依赖、构建与 smoke 工作。侧栏显示这些真实阶段，并且只有准备成功后才提供 Restart。激活时仍会重新构建并验证实时 checkout，因此 `ready` 表示候选版本通过了隔离 preflight，而不是保证激活绝不会失败；任何激活失败都会通过 recovery 恢复之前的 checkout。提升与重启仍是明确边界，因此模型修改或刚出现的 `main` commit 都不会仅因为存在就进入实时运行。

## Changed-path coverage

更新状态组件及其可见样式共同由 `packages/client/ui-settings-plugin-inventory/src/client/UpdateFooterAction.tsx`、`packages/client/ui-settings-plugin-inventory/src/client/UpdateFooterAction.module.css` 和 `packages/client/ui-settings-plugin-inventory/src/client/index.ts` 实现。分离 watcher 与 Windows 启动交接由 `scripts/phoenix-auto-update.mjs` 和 `phoenix-windows.cmd` 实现。这些路径属于同一个架构决策，必须与受保护的 stable 更新流程一起演进。
