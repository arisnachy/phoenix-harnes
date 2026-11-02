# PHOENIX Codex 与 OpenClaw 更新接收

[English](PHOENIX_UPSTREAM_INTAKE.md) | 中文

PHOENIX 通过隔离的 bridge-update channel 接收官方 Codex plugin catalog 与 OpenClaw skill catalog 的更新。

## 命令

```text
dsh upstream-update --check
dsh upstream-update --apply
dsh upstream-update --doctor
```

源码 checkout 也会随 PHOENIX process 启动 intake watcher。

## 更新策略

默认值 `PHOENIX_UPSTREAM_UPDATE_MODE=auto` 会为已经配置的 bridge 暂存并激活更新。

`PHOENIX_UPSTREAM_UPDATE_MODE=notify` 会记录可用 revision，但不修改已安装的 bridge。

`PHOENIX_UPSTREAM_UPDATE_MODE=off` 会禁用 intake watcher 与检查。

watcher 默认每十分钟轮询一次；`PHOENIX_UPSTREAM_UPDATE_POLL_MS` 可更改间隔，并且会限制为至少三十秒。

未配置的 bridge 会保持 idle，watcher 不会静默初始化它。

## 暂存与激活

intake 读取已安装的 bridge 状态，并将记录的 commit 与 `git ls-remote` 返回的官方 `main` head 进行比较。

检测到 revision 可用时，每个有变化的 bridge 都会在与 `$DSH_HOME` 同卷的私有 staging home 中同步；`PHOENIX_UPSTREAM_UPDATE_TEMP` 可以选择其父目录。

candidate 在激活前运行原生 `sync` 与 `verify` 命令，并且其状态必须标识预期的官方仓库和精确的观测 commit。

激活只移动 bridge 所有的 roots 与命名空间 managed skills；用户所有的 skills 保持在事务之外。

事务 journal 在每个 rename 执行前后记录它；live verification 失败时，从 journal backup 反向恢复已完成的操作。

中断的事务会在下一次 check 或 apply 操作前恢复。

## 安全与信任

网络错误、malformed candidate、bridge error 或 rollback 失败不会成为 PHOENIX profile boot dependency；intake 会记录 `blocked` state，并在下一个 watcher cycle 重试。

生成的 state 与 MCP patches 会拒绝旧的 `@deepseek-ai/` references 和类似凭据的字面值；environment references 保持为 references，其值不会复制到 update state。

intake 会修改 `$DSH_HOME` 下的用户 bridge data，但不会修改 PHOENIX source、`main`、`stable`、sessions、memories、projects 或 credentials。

intake 不表示 upstream skill 或 plugin 的可选 CLI、API、account、device 或 credential 可用；这些能力仍受各自的 bridge 与 permission checks 约束。
