# Windows 上的 PHOENIX

[English](phoenix-windows.md) | 中文

## 安装与更新

运行仓库 README 中的 PowerShell 单行安装命令。它会在 `%LOCALAPPDATA%\Programs\PHOENIX` 下安装专用 checkout，构建 `main` 的精确 revision，并创建 **PHOENIX HARDNESS** 开始菜单快捷方式。受管启动会获取 `origin/main`，并且只接受干净的快进更新；本地修改会停止更新，而不会被覆盖。设置 `PHOENIX_AUTO_UPDATE=0` 可以禁用启动时检查。

该引导程序可以运行，但尚未使用 Authenticode 签名。可信签名发布需要外部发布者证书，因此仍属于发布凭据 gate。

## VS Code 与 Cursor

运行 `pnpm run package:vscode`，然后通过**扩展 → 从 VSIX 安装**来安装 `dist/phoenix-hardness-vscode.vsix`。Explorer 面板可以安装或更新 PHOENIX、启动本地运行时并打开 Web 界面。它不会读取 provider 凭据。

## 原生安全边界

Windows 命令使用仓库的原生受限 token 与 ACL runner。该 runner 无法启动时，`read-only` 与 `workspace-write` 会以失败关闭。后端报告 partial enforcement，因为 Windows ACL 无法保证网络隔离、进程不可见性，也无法防御所有 `Everyone` grant 与 hard-link alias。`danger-full-access` 会绕过文件 fence，因此 PHOENIX 的 approval policy 始终保持为 `ask`；该模式不会被描述为 sandbox。

请在真实 Windows kernel 上运行 `pnpm run check:ci:windows-complete`，以取得权威原生 gate。Wine 只是兼容性信号，不能证明 Windows ACL 后端。

## Continuity

Session history 保持本地 durable，PHOENIX 默认不会上传。未来的 cloud backup 必须是 opt-in，在传输前加密，移除 credential，感知 revision，并安全处理 conflict；telemetry 不是 history backend。在同一 revision 的真实远程 receipt 与 restore test 通过之前，不会宣传 cloud-history provider。
