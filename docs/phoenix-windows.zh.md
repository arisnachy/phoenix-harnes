# Windows 上的 PHOENIX

[English](phoenix-windows.md) | 中文

## 安装与更新

运行仓库 README 中的 PowerShell 单行安装命令。它会在 `%LOCALAPPDATA%\Programs\PHOENIX` 下安装专用 checkout，构建 `main` 的精确 revision，并在开始菜单、Windows 启动文件夹和任务栏快捷方式存储位置创建 **PHOENIX HARDNESS** 快捷方式。如果 Windows 版本没有提供本地化的固定到任务栏操作，仍会创建可用于任务栏的快捷方式；从快捷方式上下文菜单固定一次即可。使用 `-NoStartup` 或 `-NoTaskbar` 可选择退出。受管启动会获取 `origin/main`，并且只接受干净的快进更新；本地修改会停止更新，而不会被覆盖。设置 `PHOENIX_AUTO_UPDATE=0` 可以禁用启动时检查。

该引导程序可以运行，但尚未使用 Authenticode 签名。可信签名发布需要外部发布者证书，因此仍属于发布凭据 gate。

## 桌面快捷方式

标准 **Phoenix** 快捷方式会启动受支持且已安装的原生 `Phoenix.exe`（版本 1.0.20 或更高），使用内嵌 WebView2 外壳，并记录持久化的源码检出目录以选择后端。原生窗口会连接已经健康运行于 `127.0.0.1:3080` 的 Phoenix，或者启动受监管的后端。若没有兼容的已安装 EXE，快捷方式会隐藏 PowerShell 并用普通浏览器启动源码 Web 应用。快捷方式不会显示旧版 EXE 的拒绝提示，也不会留下交互式 PowerShell 窗口。

## 接管先前的 Phoenix 实例

在 Windows 上，`pnpm phoenix` 会验证同一官方检出目录、其身份隔离的运行时，或能够证明更旧的官方检出目录中是否存在先前的 Phoenix Host。只有候选实例通过预检和进程身份核验（所有者、命令、PID、父进程及创建时间）后，才会替换旧 Host。若确认有关联的 Phoenix.exe 桌面窗口，也会先关闭该窗口。绝不终止占用该端口的非 Phoenix 应用。

## VS Code 与 Cursor

运行 `pnpm run package:vscode`，然后通过**扩展 → 从 VSIX 安装**来安装 `dist/phoenix-hardness-vscode.vsix`。Explorer 面板可以安装或更新 PHOENIX、启动本地运行时并打开 Web 界面。它不会读取 provider 凭据。

## 原生安全边界

Windows 命令使用仓库的原生受限 token 与 ACL runner。该 runner 无法启动时，`read-only` 与 `workspace-write` 会以失败关闭。后端报告 partial enforcement，因为 Windows ACL 无法保证网络隔离、进程不可见性，也无法防御所有 `Everyone` grant 与 hard-link alias。`danger-full-access` 会绕过文件 fence 并使用 `never` approval policy，因此选择 Full access 不会为文件操作创建第二个 approval prompt；该模式不会被描述为 sandbox。

请在真实 Windows kernel 上运行 `pnpm run check:ci:windows-complete`，以取得权威原生 gate。Wine 只是兼容性信号，不能证明 Windows ACL 后端。

## Continuity

Session history 保持本地 durable，PHOENIX 默认不会上传。未来的 cloud backup 必须是 opt-in，在传输前加密，移除 credential，感知 revision，并安全处理 conflict；telemetry 不是 history backend。在同一 revision 的真实远程 receipt 与 restore test 通过之前，不会宣传 cloud-history provider。
