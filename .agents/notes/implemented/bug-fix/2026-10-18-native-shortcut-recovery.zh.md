# Agent Note：恢复原生桌面快捷方式

Status: implemented

[English](2026-10-18-native-shortcut-recovery.md) | 中文

## Problem

安装程序已包含交互式 Windows 原生外壳、WebView2、单实例窗口信号和连接现有 Phoenix 后端的能力，但仓库的快捷方式把启动目标覆盖成始终可见的 PowerShell 窗口。具有受支持原生安装的用户因此无法使用嵌入式桌面体验，还会看到具有误导性的旧版 EXE 拒绝信息。

## Decision

标准快捷方式只选择已安装且版本为 1.0.20 或更高的 Phoenix.exe，并传入持久检出目录指针。对于仅有源码的机器，仍使用受监管但隐藏的 PowerShell 启动器。再次从源码启动时，会重新打开兼容的现有 Web 界面，而不是争用 TCP 端口 3080。原生外壳现在也能发现直接位于 `ChatGPT/Phoenix` 的检出目录。

Windows 验收要求：受支持的 EXE 打开嵌入式窗口；只有源码的快捷方式在默认浏览器打开且不显示控制台；再次点击会重新打开 Phoenix；缺失或过时的 EXE 不得取代正常运行的源码启动方式。现有更新器继续负责运行时切换和回滚，不会终止任意占用端口的进程。

## Consequences

仅源码安装仍有隐藏的受监管备用启动方式，不得终止占用端口的无关应用程序。

## Alternatives considered

拒绝始终启动可见的 PowerShell 终端来取代已安装的原生外壳，因为这样会绕过受支持的桌面体验。
