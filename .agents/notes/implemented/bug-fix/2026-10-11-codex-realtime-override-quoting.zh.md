# Agent Note: Codex Realtime ChatGPT 登录覆盖参数必须正确传递

Status: implemented

[English](2026-10-11-codex-realtime-override-quoting.md) | 中文

## Problem

Phoenix Codex Live 语音以前使用 `-c forced_login_method='chatgpt'` 启动 CLI。即使 ChatGPT 登录已经有效，Codex CLI 0.162.1 也可能在验证账户之前拒绝该参数，报告 `Invalid override (missing '='): chatgpt`。Windows 备用启动路径使用 `cmd.exe /c` 拼接命令而不是直接传递参数数组，因此需要单独处理引号。

## Decision

托管的 Node Codex 入口和非 Windows 直接启动路径收到一个完整的 TOML 字符串参数 `forced_login_method="chatgpt"`。Windows `cmd.exe` 备用路径改用语义相同的 `forced_login_method=chatgpt`：Codex 配置覆盖解析器会把无法按 TOML 解析的值当作普通字符串，避免 Shell 丢失引号。本次不修改登录、token 刷新、SQLite、Realtime 协议或会话持久化机制。

## Alternatives considered

不修改 `CODEX_HOME` 或强制注销重新登录，因为账户已经有效，失败发生在命令行解析阶段。

没有在所有启动路径外层添加 Shell 引号，因为只有 Windows PATH 备用路径经过 `cmd.exe`，其引号行为依赖平台；托管 Node 启动路径应直接携带双引号 TOML 值。

## Consequences

语音启动不会再仅仅因为强制登录覆盖参数的引号问题而在 `account/read` 之前失败。修复不能保证远端 Realtime/WebRTC 服务必然可用，后续连接错误仍要如实报告。Phoenix 继续从子进程环境移除 `OPENAI_API_KEY`，仅使用 ChatGPT 订阅账户。

## Testing

回归测试验证托管和 Unix argv 中恰好有一个带双引号的 TOML 覆盖参数，Windows 备用命令则使用 Shell 安全的等效值。模拟的托管 app-server 只有收到正确的双引号值才允许初始化。真实 Codex 0.162.1 与 Windows Live 音频仍需单独集成验证。
