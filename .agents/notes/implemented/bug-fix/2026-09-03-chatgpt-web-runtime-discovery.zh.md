# Agent Note: ChatGPT Web 自动发现完整的 Windows 运行时

状态：已实现

[English](2026-09-03-chatgpt-web-runtime-discovery.md) | 中文

## 问题

`chatgpt-web` 路由指向正确的本地回环端口，但 Phoenix 要求手动提供启动命令，也无法区分完整的 Codex Web GPT 安装和不完整的运行时。因此网桥不可达并产生 `TRANSPORT` 失败。

## 决策

在 Windows 上，只有标准安装位置同时包含 Bun、CLI 入口和 `playwright-core` 时，Phoenix 才自动发现打包的 Codex Web GPT 运行时。运行时通过 argv 数组和应用工作目录启动；显式的 `PHOENIX_CHATGPT_WEB_COMMAND` 仍然优先。

## 考虑过的替代方案

**始终要求 `PHOENIX_CHATGPT_WEB_COMMAND`。** 否决，因为受支持的 Windows 启动器已经提供完整运行时，额外的手动路径正是网桥不可达的直接原因。

**选择任意匹配的运行时目录。** 否决，因为用户的版本化安装缺少 `playwright-core`；启动它只会产生已退出的进程和误导性的传输错误。

## 结果

启动器完成 `Setup > Browser-only` 后，`dsh chatgpt-web start` 可以在没有 API key 或 shell 命令的情况下管理本地网桥。仍然需要浏览器会话和符合条件的 ChatGPT 账户，并且选择模型路由前 `dsh chatgpt-web status` 必须报告 `ready`。
