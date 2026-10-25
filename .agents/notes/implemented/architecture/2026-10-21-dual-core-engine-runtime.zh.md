# Agent Note: 双引擎运行时隔离

Status: implemented

[English](2026-10-21-dual-core-engine-runtime.md) | 中文

## 问题

PHOENIX 需要让 Codex 与 OpenClaw 执行引擎共存，同时使 OpenClaw 更新与宿主 Node 安装、Phoenix 更新状态、凭据和正在执行的任务保持隔离。

## 决策

脚本 [`scripts/phoenix-engine-runtime.mjs`](../../../../scripts/phoenix-engine-runtime.mjs) 负责 `$DSH_HOME/openclaw-runtime` 下 OpenClaw candidate 的有限生命周期，并以异步函数提供检查、准备、激活、回滚、启动和停止操作。

官方准备流程只获取固定版本 `openclaw/openclaw` 的 npm metadata 与 tarball，以及固定版本的官方 Windows x64 Node archive。写入 candidate 前会验证 registry SHA-512、Node `SHASUMS256.txt` 中的 SHA-256、archive 路径 containment，以及固定 `package/openclaw.mjs` 的字节内容。验证后的 tarball 通过隔离 Node 的 `npm-cli.js` 安装，并使用 `--ignore-scripts`、`--omit=dev`、`--no-audit` 和 `--fund=false`；candidate entrypoint 保留在 `runtimePath/node_modules/openclaw/openclaw.mjs`，从而维持 package-relative imports。准备过程使用 lock、限制下载大小和 process output，并提供可配置的安装 timeout；不会写入 active marker，也不会修改全局 Node 状态。兼容 helper 在接受已经 staging 的 candidate 前，会独立获取并比对官方 metadata。

激活操作使用选定的 Node executable 和 entrypoint、固定的 `gateway run --bind loopback --port <port>` 参数，以及位于隔离 runtime 下的私有 `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` 值、经过清理的环境、`shell: false` 和 `windowsHide: true` 启动 candidate。只有官方 `openclaw health --json` 命令成功退出、返回非 starting 的 JSON object 且 gateway child 仍存活时，active marker 才会改变。

Phoenix 的 live、uncertain 或进行中的 execution phase 会推迟激活和回滚。health 或 process 检查失败时保留先前的 active marker。检查结果从 `$DSH_HOME/codex-cli/active.json` 读取 Codex，并合并 Phoenix managed marker、update state 和隔离的 OpenClaw marker，但不返回环境值或凭据。

## Alternatives considered

**把 OpenClaw 安装到宿主 Node 环境** 被拒绝，因为受支持的 OpenClaw Node 版本线可能不同于 Phoenix 宿主版本线，全局修改会把引擎生命周期与宿主升级耦合。

**接受任意 package URL 或 repository identity** 被拒绝，因为 updater 必须在激活前核验官方 `openclaw/openclaw` registry metadata 和固定 digest。

**在 health 核验前替换 active marker** 被拒绝，因为失败的 gateway 必须保留最后一个已核验的 runtime 并保持可回滚。

**使用继承的参数、channels 或 tokens 启动** 被拒绝，因为该 adapter 只负责进程监管；凭据和 channel 配置仍由更高层显式负责。

## 后果

该 adapter 是 filesystem 与 process lifecycle seam，并带有有界的官方准备流程。父 updater 决定何时安装，本模块负责 source 和 digest pinning、隔离的 Node/npm 状态、health 检查、busy 推迟和 marker 转换。

测试 runner 可注入以执行确定性的生命周期检查。默认 readiness 检查使用官方回环 `/readyz` HTTP 端点，并限制响应大小及请求时间，不再为每次轮询启动另一个 CLI。就绪需要 HTTP 准入成功、明确成功的 JSON 和存活子进程。真实 Windows 冷启动在三分钟后仍导入会话模块，因此首次启动允许有界的十分钟；普通健康及停止检查保留较短预算。激活、启动和回滚重新核验产物及入口摘要，在每个隔离运行时内串行化，并在写入或静止确认失败时保留标记。持久所有者句柄锁拒绝并发或未知的跨进程所有者。停止会等待拥有的子进程，不会在句柄丢失后凭持久化 PID 终止进程。夹具测试不能证明真实 Gateway 兼容性。

active marker 只包含启动 metadata 和 status，不持久化环境变量、authorization headers、token 值、channel 定义或任意命令参数。

## 证据边界

针对性检查覆盖官方来源及归档核验、有界输出及等待、候选失败后的恢复、HTTP readiness、产物复核、繁忙推迟及串行生命周期。官方 OpenClaw 2026.10.5 已使用隔离 Node 24.22.1 完成准备。有界隔离原生检查通过协议 4 认证及健康检查；另一次检查完成会话、代理、cron、skills、渠道状态的公开读取及传输重连。扩展测试随后因 `ENOTEMPTY` 未能清理临时文件；之后的进程及端口检查没有发现残留的受监管 Gateway。这些检查不能证明模型驱动的操作任务、渠道发送、持久激活、原生升级或回滚。全局空闲证明实现之前，生命周期控制仍不可用。
