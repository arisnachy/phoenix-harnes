# PHOENIX 稳定自动更新

[English](PHOENIX_AUTO_UPDATE.md) | 中文

PHOENIX 源码安装使用经过审查的稳定通道，而不是盲目拉取 GitHub 上的每一个 branch。

Codex plugin 与 OpenClaw skill 更新使用[PHOENIX Codex 与 OpenClaw 更新接收](PHOENIX_UPSTREAM_INTAKE.zh.md)中描述的独立 staged intake；它们不会修改 PHOENIX source files。

## 发布路径

```text
upstream / labs / feature branches
            |
            v
phoenix/evolution-inbox
            |
      KIRA + CI gates
            |
            v
          main
            |
       CI succeeds
            |
            v
 phoenix/update-channel
            |
            v
     PHOENIX installs
```

`main` 是集成事实来源。CI 成功后，晋升的 `stable` branch 才是安装所使用的发布指针。`.github/workflows/phoenix-stable-update-channel.yml` 会把通道身份和审计元数据发布到隔离的 `phoenix/update-channel` branch 的 `.phoenix/channel/stable.json`；更新器直接获取 `origin/stable` 的当前精确 SHA，因此即使元数据 branch 没有变化，后续晋升也会被检测到。

更新通道只包含元数据。实验性源码绝不会被复制到其中，客户端也绝不会从 `phoenix/evolution-inbox`、Codex branches、Claude branches、DeepSeek upstream branches 或 laboratory branch 安装。

## 客户端行为

源码 checkout 会运行 `scripts/phoenix-auto-update.mjs`。

默认策略是 `PHOENIX_UPDATE_MODE=auto`：

1. 验证 `origin` 是官方 PHOENIX 仓库；
2. 获取晋升的 `stable` branch（或 `PHOENIX_UPDATE_STABLE_BRANCH`）；
3. 获取稳定通道 manifest；
4. 验证获取到的 stable commit 已存在于本地；
5. 拒绝降级或分叉历史；
6. 当 worktree 包含本地修改时拒绝自动变更；
7. 在候选 commit 上创建分离的临时 Git worktree；
8. 在其中执行 frozen dependency install、完整 build 和 CLI smoke test；
9. 将当前 commit 记录到 `refs/phoenix/recovery/last-good`；
10. 仅使用 `git merge --ff-only` 推进干净的实时 `main` 或 `stable` checkout；
11. 安装、重建并对实时 worktree 执行 smoke test；
12. 如果实时步骤失败，则重置到 recovery commit 并重建最后一个已知良好版本。

更新器不会读取、复制、重置、删除或迁移 `$DSH_HOME`、credential stores、sessions、user projects、memories 或其他用户数据。

## PHOENIX 运行期间

CLI 会启动低频更新 watcher。默认轮询间隔为十分钟。当新的稳定 SHA 出现时，正在运行的 harness 会显示更新通知，但不会在 session 活跃期间替换自身文件。在 `auto` 模式下，安装会延迟到该 PHOENIX process 退出之后；届时候选版本会在安装前重新获取并重新验证。

下一次 Windows 启动也会在 boot 前执行更新检查。普通的网络/通道故障会保留最后一个已知良好的 PHOENIX。只有极端情况下实时更新和 rollback 都失败时，才使用致命 updater exit code `12`。

## 策略控制

- `PHOENIX_UPDATE_MODE=auto` — 默认；安全地通知并安装稳定更新。
- `PHOENIX_UPDATE_MODE=notify` — 通知有更新，但不修改 checkout。
- `PHOENIX_UPDATE_MODE=off` — 禁用稳定通道检查。
- `PHOENIX_UPDATE_POLL_MS=<milliseconds>` — watcher 间隔，最短限制为一分钟。

开发 branches 永远不会被自动修改，但仍会获取并报告晋升的 stable target，让 UI 能显示有更新而不重写本地工作。只有发布指针仍名为 `main` 的安装才应设置 `PHOENIX_UPDATE_STABLE_BRANCH=main`。

## 恢复与审计

更新前的最后一个源码 commit 保留在：

```text
refs/phoenix/recovery/last-good
```

最近一次 updater 结果写入仓库 Git 元数据：

```text
.git/phoenix-update-state.json
```

该状态记录 source/target SHAs 和结果，不记录 credentials 或用户内容。

## 信任边界

此机制只分发已经跨过 PHOENIX 稳定边界的 commit。它被刻意设计成不是点对点自我修改系统。本地 PHOENIX 可以在自己的 laboratory/evolution 边界内发明工具、specialists、strategies、experiments 或候选源码更改，但可执行的 evolution 仍必须成为经过审查的源码并通过仓库 gates，之后才能进入 `main`，也因此才能到达其他 PHOENIX 安装。
