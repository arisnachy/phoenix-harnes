# Agent Note: Computer Use、worktree、rewind 与 E2B 的执行自主性

Status: implemented

[English](2026-09-04-execution-autonomy-computer-worktree-rewind-e2b.md) | 中文

## Problem

PHOENIX 已经具备强健的权限、会话、子代理和远程运行时基础能力，但缺少一条连贯的产品路径来提供 Windows 桌面控制、隔离的并行文件系统工作、面向用户的 rewind，以及可恢复的 E2B 所有权。如果分别独立增加这些能力，就可能重复权限开关、在清理时破坏子代理工作、改写会话历史，或意外删除用户拥有的远程 sandbox。

搜索锚点：`computer use`、`worktree`、`rewind`、`E2B`。

## Decision

`@phoenix-ai/dsh-tool-pwsh` 注册仅限 Windows 的 `computer` 工具，其封闭动作集合为 `screenshot`、`move`、`click`、`double_click`、`drag`、`type`、`key` 和 `scroll`。模型提供的值只通过环境变量进入固定的 PowerShell/C# 驱动程序，绝不会插值到可执行源代码中。桌面权限直接派生自现有 sandbox policy，而不是新增另一项持久权限开关：`read-only` 只能观察，`workspace-write` 和 `danger-full-access` 允许交互。`workspace-write` 下的交互动作使用现有 approval service；`danger-full-access` 是明确的无提示权限。缺少权限事实时默认拒绝。截图通过可选 attachment capability 保存，并延迟注入模型上下文作为图像内容。

`@phoenix-ai/dsh-subagent-in-process-driver` 在启用隔离时，为 one-shot 子代理创建确定性的分支和关联 Git worktree。内置 spawn 与 fork provider 默认启用该能力。非 Git 工作区保持原行为；一旦检测到 Git，worktree 创建失败会作为致命错误处理，而不会静默降级为共享写入。清理只移除干净的 worktree，保留有未提交修改的 worktree，并保留分支，因此已提交的子代理工作不会被生命周期清理销毁。可继续的 fork 会话仍使用共享工作区，因为该路径由 continuation manager 而不是 one-shot driver 管理。

当 commands capability 存在时，`@phoenix-ai/dsh-session-checkpoint-policy` 提供 `/fork [event-seq]` 和 `/rewind [completed-turns]`。两者都调用现有的 append-only `sessions.fork()` 原语，因此源会话及其未来历史保持完整。rewind 边界选择前一个已完成的 `turn/end` 事件，因为 `SessionStore.fork()` 接受包含式事件序号，并拒绝结束在未闭合 turn 内的边界。会话 rewind 不会假装能够回滚任意文件系统状态；并行子代理的文件系统隔离由 Git worktree 提供。

`@phoenix-ai/dsh-e2b` 接受已有的 `sandboxId`，通过 SDK 重新连接，重新应用配置的 timeout，并公开当前 sandbox id 以便持久化。释放时支持明确的 `kill`、`pause` 和 `retain` 策略，其中 `kill` 仍是向后兼容的默认值。新创建的 sandbox 在初始化失败时仍会回滚，而由用户提供并重新连接的 sandbox 不会仅因为 PHOENIX 接管失败就被销毁。

## Alternatives considered

**单独持久化 `computer/mode` 权限开关** — 被拒绝，因为它可能与已经持久化的 sandbox 和 approval policy 漂移。复用现有事实可让桌面权限自然继承现有会话和子代理权限模型。

**并行 one-shot 子代理共享工作目录** — 不作为默认方案，因为并发写入可能冲突并使所有权不明确。Git worktree 使用仓库原生机制提供隔离，无需手工复制仓库。

**通过截断会话日志或重置文件来破坏性 rewind** — 被拒绝，因为 PHOENIX 会话是 append-only，而且无法安全推断任意文件系统回滚。因此 rewind 通过 fork 非破坏性地分支历史。

**释放时始终 kill E2B sandbox** — 保留为默认行为，但不再是唯一策略；长周期工作流需要明确的 pause 或 retain 语义以及安全的 reconnect。

## Consequences

- observe-only 权限下无法执行桌面输入；模型只获得封闭且经过验证的动作界面，而不是任意主机命令。
- one-shot Git 子代理默认获得隔离 checkout，同时未提交或已提交的工作在清理后仍可保留。
- `/fork` 和 `/rewind` 保留原始对话及其未来历史，而不是重写历史。
- 当调用者明确选择 `pause` 或 `retain` 时，E2B 会话可以跨 PHOENIX 进程生命周期存活，同时历史上的默认 `kill` 行为保持不变。
- Windows Computer Use 是首个内置桌面 actuator；非 Windows 主机不会注册该工具。
