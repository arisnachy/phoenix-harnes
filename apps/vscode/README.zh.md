# 适用于 VS Code 与 Cursor 的 PHOENIX HARDNESS

[English](README.md) | 中文

此扩展会在 Explorer 中添加 PHOENIX 面板，其中包含安装或更新 PHOENIX、启动已安装的本地 harness，以及打开其 Web 界面的命令。在 Windows 上，它会发现单行安装程序的默认位置；也可以通过 `phoenix.installPath` 选择另一个 checkout。

安装 CI 固定的 `@vscode/vsce` 版本后，使用 `pnpm --filter phoenix-hardness-vscode run package:vsix` 打包 VSIX。此扩展不包含凭据，也不会读取 PHOENIX 凭据存储。

## 当前限制

第一版集成负责控制本地运行时。在通过已验证身份的 IDE RPC 投影实现之前，会话、diff、批准与团队视图仍保留在 PHOENIX Web UI 中。
