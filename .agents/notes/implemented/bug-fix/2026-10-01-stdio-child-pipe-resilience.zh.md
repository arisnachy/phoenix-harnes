# Agent Note: Stdio 子进程管道故障保留在传输边界内

Status: implemented

[English](2026-10-01-stdio-child-pipe-resilience.md) | 中文

## Problem

PHOENIX 有两条长期运行的 Host 路径会向短生命周期子进程的 stdin 管道写入数据：Codex app-server 模型发现和 MCP stdio 传输。子进程可能在 spawn 之后、请求写入或清理完成之前退出。在 Node 中，尤其是在 Windows 上管道会表现为 Socket，这个竞态可能在可写流上以 `error` 事件发出 `EPIPE` 或 `ERR_STREAM_DESTROYED`。写入回调可以同时报告同一个 RPC 失败，但如果流事件无人接管，它仍会成为未捕获异常并终止整个 Host。Windows supervisor 随后会重启 PHOENIX，但短暂的 provider 超时不应升级成应用崩溃。

同一日志时间窗里还可能出现 stable 更新 watcher 的 Git 连接重置。该 watcher 已经会封装网络失败并退避重试，而且不拥有 Host 生命周期，因此它不是本次崩溃路径的一部分。

## Decision

Codex 模型发现现在会在元数据 app-server spawn 后立即接管 `child.stdin` 的错误事件。活动 JSONL 写入仍通过现有写入回调报告失败；清理阶段不会再对已经 destroyed 或 ended 的管道调用 `end()`，并会封装同步关闭竞态。

MCP 客户端现在使用一个很小的 `StdioClientTransport` 兼容子类。SDK 同步 spawn 子进程之后，PHOENIX 会立即给 SDK 子进程 stdin 安装错误监听器，发生时间早于 MCP Client 发送 `initialize`。预期的 `EPIPE` 和 `ERR_STREAM_DESTROYED` 被视为传输关闭；其他可写错误通过传输已有的 `onerror` 回调转发。协议关闭和重连策略仍由 MCP SDK 与 PHOENIX connection supervisor 管理。

不会增加进程级 `uncaughtException` 过滤器。Provider 或 connector 故障继续作为局部、可观察的失败处理，而不是在全局被隐藏。

## Alternatives considered

**只依赖 Windows supervisor 重启。** 拒绝，因为这种方案只能在用户可见的中断发生之后恢复，而且相同的短生命周期子进程竞态可能无限重复。

**安装进程级 EPIPE 未捕获异常过滤器。** 拒绝，因为它无法可靠地区分这些已知传输竞态和其他无关 broken pipe，并且会让 Host 在异常已经逃离所有权边界后继续运行。

**提高 Codex 模型刷新超时。** 拒绝，因为观察到的 Codex models-manager 超时来自上游子进程行为；延长外层超时并不会接管可写流事件，因此无法阻止 Node Host 崩溃。

**把 stable Git watcher 的连接重置当作根因。** 拒绝，因为 watch 模式已经会捕获该 fetch 失败、写入重试状态并退避。它只是时间上相邻，并非致命错误。

## Consequences

Codex catalog 刷新或 MCP server 在 PHOENIX 写入时退出后，现在可以失败、关闭或重连，而不会终止 Host。Codex 保留现有 last-good/static catalog 行为，MCP 也保留有界重连策略。兼容 shim 依赖 MCP SDK 当前的 `_process` 字段；一个聚焦的运行时回归测试会固定这个假设，因此未来 SDK 布局变化会让 CI 明确失败，而不是静默移除保护。

## Testing

包级回归测试会模拟 Codex stdin 的 `EPIPE`，并运行一个真实的 MCP stdio 子进程后在其 stdin 上发出 `EPIPE`。测试断言可写流存在错误所有者，且该事件不会逃逸成未捕获异常。
