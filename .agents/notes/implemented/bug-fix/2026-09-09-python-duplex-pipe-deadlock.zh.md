# Agent Note: Python duplex-pipe deadlock

Status: implemented

[English](2026-09-09-python-duplex-pipe-deadlock.md) | 中文

## Problem

Python runtime 在 host 回复读取器活动时进行重复 binding 调用可能停滞。本地 faulthandler 证据显示，异步回复读取器运行期间，Python 主线程阻塞在 `runtime.py` 的 `send()`/`flush()`。使用现有 `maxWallMs: 3000` 预算的 100 次成功与拒绝 binding 交替回归测试在旧布局下复现失败，在修复后的 runtime 下通过。[Node issue #29238](https://github.com/nodejs/node/issues/29238) 只作为管道行为的背景，不证明 Node 存在同一个缺陷。

## Decision

runtime 使用两个 child protocol 管道。`PROTOCOL_READ_FD = 3` 承载 host 到 child 的 `boot` 与 `run` 请求；`PROTOCOL_WRITE_FD = 4` 承载 child 到 host 的 `boot-ack`、`call`、`log` 与 `done` 回复。Node 启动五个位置管道，使 stdin、stdout、stderr、fd 3 与 fd 4 保持独立。host 写入 fd 3 并读取 fd 4；Python bootstrap 从 fd 3 读取并向 fd 4 写入。stdout 与 stderr 继续是专用捕获流。

JSON-lines protocol、host 侧对 child 帧的校验与重建、child 空环境、输出限制、取消与墙钟预算保持不变。没有通过增加原有墙钟计时器来掩盖停滞。

## Verification

真实子进程回归测试在 `maxWallMs: 3000` 下交换 100 次成功与拒绝 binding；双管道 runtime 通过。聚焦的 Python runtime 套件通过全部六个测试，包括该回归测试，且没有增加原有计时器。基于 Loader 的 snapshot 启动编译后的 provider，并通过组装的 headless 示例完成 200 次 binding 调用。protocol mirror 检查两个描述符常量与共享消息词汇。

## Alternatives considered

**继续使用一个双向 protocol 描述符。** 拒绝，因为本地失败显示同步 `send()`/`flush()` 可能在另一侧读取回复时阻塞。

**增加墙钟超时。** 拒绝，因为这会改变执行预算，同时保留管道争用，并可能掩盖停滞。

**把 Node issue #29238 当作根因证明。** 拒绝，因为外部 issue 只是背景证据；本地 faulthandler trace 与旧布局和新布局的回归差异才是这个 runtime 的依据。

## Consequences

wire vocabulary 现在携带明确的描述符方向：fd 3 是 host 到 child 的输入，fd 4 是 child 到 host 的输出。Child 回复仍是 host 校验的敌意输入；host 请求留在由 host 控制、child 信任的流上。未来 protocol 变更必须同时更新 TypeScript 常量、Python mirror、spawn 描述符布局、README 配对文件与 protocol-mirror 测试。
