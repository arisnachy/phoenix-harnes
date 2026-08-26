# PHOENIX Codex 插件武器库

[English](codex-plugin-arsenal.md) | 中文

PHOENIX 可以使用官方 Codex 插件市场，而无需把上游插件仓库直接 vendoring 到这个公开源码树中。

## `sync` 会安装什么

```powershell
corepack pnpm run dsh -- codex-plugin sync
```

该命令会在 `$DSH_HOME/codex/openai-plugins` 下维护 `openai/plugins` 的受管 checkout，读取官方 marketplace 以及各插件的 `.codex-plugin/plugin.json`，随后生成本地 PHOENIX 武器库索引。

PHOENIX 对受支持的 Codex 能力面进行如下桥接：

- **Skills**：复制到 `$DSH_HOME/skills`，并使用命名空间化的 `codex-*` skill 名称。现有 `@deepseek-ai/dsh-skill-filesystem` provider 会在下一次 catalog 刷新或启动时发现它们。
- **MCP servers**：把每个插件的 `.mcp.json` 转换成 PHOENIX `@deepseek-ai/dsh-mcp-client` Cordis patch。除非显式启用，否则它们保持禁用。
- **Agents、commands、hooks、apps、scripts 与 assets**：保留在受管的上游 checkout 中，并记录到 `arsenal.json`。PHOENIX 不会仅因为某个 Codex hook 或 app 声明存在就执行它；不受支持的可执行能力保持惰性，而不会静默获得主机权限。

这一设计刻意遵循 capability-safe 原则。安装武器库**不会**自动授予每个插件浏览器、shell、文件系统、凭据或远程服务权限。

## 检查武器库

```powershell
corepack pnpm run dsh -- codex-plugin list
corepack pnpm run dsh -- codex-plugin inspect github
corepack pnpm run dsh -- codex-plugin doctor
corepack pnpm run dsh -- codex-plugin path
```

`list` 显示每个插件的上游版本以及检测到的能力面。`doctor` 验证本地桥接，并且只按**变量名**报告缺失的凭据环境变量；秘密值永远不会写入武器库索引或生成的 patch。

## 启用由 MCP 支撑的插件

```powershell
corepack pnpm run dsh -- codex-plugin enable github
```

已启用的 MCP 插件会合并到 `$DSH_HOME/codex/enabled.patch.yml`。PHOENIX launcher 会在下一次 profile 启动时自动附加该 patch。若要在一次启动中绕过全部 Codex MCP 插件：

```powershell
$env:PHOENIX_CODEX_PLUGINS = 'off'
.\phoenix-windows.cmd
```

要禁用单个 connector：

```powershell
corepack pnpm run dsh -- codex-plugin disable github
```

仅包含 skills 的插件不需要执行 `enable`；同步后的 skills 已可通过常规 PHOENIX skill catalog 使用。

## 身份验证与秘密

Codex 插件的 MCP 元数据可以引用诸如 `GITHUB_PAT_TOKEN` 的环境变量。PHOENIX 会保留该引用，并且只在运行时解析它；绝不会把值复制到生成的 patch 或 `arsenal.json` 中。

不要盲目启用所有 MCP 插件。一次性暴露过大的工具目录会消耗模型上下文，并不必要地扩大权限面。应同步完整武器库，然后只启用当前工作流所需的远程能力。

## 更新武器库

再次运行 `sync`。PHOENIX 会快速更新受管的 `openai/plugins` checkout 到上游 `main`，重新生成 inventory 和命名空间化 skills，重新生成 MCP patch，并为仍然暴露兼容 MCP server 的插件保留其已启用状态。
