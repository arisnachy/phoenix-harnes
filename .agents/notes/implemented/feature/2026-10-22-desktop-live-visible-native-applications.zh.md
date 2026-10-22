# Agent Note: Desktop Live 可视化 Windows 原生应用

Status: implemented

English | [中文](2026-10-22-desktop-live-visible-native-applications.zh.md)

## Problem

Phoenix 已有受到权限控制的 Windows `computer` 工具及仅限当前用户访问的命名管道。模型可在后续步骤看到截图，但 Windows 外壳只展示 MiniBrowser；Kira 控制 Paint、记事本等原生程序时，用户看不到这些程序的实时画面。过去还需要环境变量手动开启 Computer Use。

## Decision

Windows 默认注册 Computer Use；设置 `PHOENIX_DESKTOP_COMPUTER=0` 可以关闭。既有沙箱与操作审批仍然有效。一般网页任务仍由 Chrome 连接器和原有 WebView2 MiniBrowser 处理。

在执行桌面变更前，模型工具通过当前用户的命名管道向 Desktop Live 发送预检请求，包括会话 ID 与可选窗口选择器。30 秒租约阻止其他会话同时操作。原生预览窗口提供暂停开关；暂停时拒绝之后的桌面变更操作，不能通过 PowerShell 回退绕过。界面在原 60/40 布局右侧使用 `PrintWindow` 每 850 毫秒刷新选定原生窗口；成功的原生截图也供模型重新观察。预检不会抢夺目标程序焦点。

用户可手动隐藏预览，之后不会自动重新打开；按 Ctrl+F10 可恢复。没有新增不受限制的键鼠执行器。没有原生桌面外壳时，仍使用原 PowerShell 执行器及既有权限策略。

此前 Desktop Live 只存在于 Windows 原生侧边栏，因此用户通过网页聊天时看不到正在操作的程序。现在 Web 应用经由已有 Windows 本地命名管道，提供有限的只读 `/phoenix-desktop-live/state` 和 `/phoenix-desktop-live/frame` 路由。只有当确切会话 ID 拥有可见原生预览时，代理才会返回真实帧。用户要求 Paint 或 Desktop Live 时，聊天内出现对应的 React 视图，轮询实际状态和验证过的 PNG；未连接时明确报告，而不伪造画面。原有 MiniBrowser 和按会话隔离的 CDP 操作不变。

## Alternatives considered

**用通用网页视图取代 MiniBrowser。** 不采用：WebView2 无法嵌入任意原生程序窗口，也无法替代其可访问性接口，还会破坏现有网页会话。

**每次刷新都激活 Phoenix。** 不采用：会抢走目标窗口焦点，使后续窗口校验与鼠标操作失败；使用针对窗口的 `PrintWindow` 可以避免此问题。

**新增独立自主的桌面执行器。** 不采用：既有 PowerShell/C# 驱动已有安全和操作后观察约束；第二套执行器增加策略风险，却不能解决显示问题。

## Consequences

原有 Computer 工具可在原生侧边栏显示 Paint 等程序，提供用户可见的暂停功能与会话租约；MiniBrowser 保持独立，操作依然受审批策略约束。部分 GPU 或特权窗口不支持 `PrintWindow`，应明确显示捕获失败而不是伪造画面。租约阻止并发操作，但不等于为每个会话提供独立操作系统桌面。仍需 Windows CI 和真实 Paint 会话进行端到端验证。
