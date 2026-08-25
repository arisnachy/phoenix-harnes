# PHOENIX Codex 插件武器库

[English](codex-plugin-arsenal.md) | 中文

PHOENIX 可以使用官方 Codex 插件市场，而无需把上游插件仓库 vendoring 到这个公开源码树中。

## `sync` 会安装什么

```powershell
corepack pnpm run dsh -- codex-plugin sync
```

该命令会在 `$DSH_HOME/codex/openai-plugins` 下维护 `openai/plugins` 的托管 checkout，读取官方 marketplace 以及每个 `.codex-plugin/plugin.json`，然后构建本地 PHOENIX 武器库索引。

PHOENIX 按以下方式桥接受支持的 Codex surface：

- **Skills**：以带命名空间的 `codex-*` skill 复制到 `$DSH_HOME/skills`。现有 `@deepseek-ai/dsh-skill-filesystem` provider 会在下一次 catalog 刷新或启动时发现它们。
- **MCP servers**：把每个插件的 `.mcp.json` 转换成 PHOENIX `@deepseek-ai/dsh-mcp-client` Cordis patch。在明确启用之前，它们保持禁用。
- **Agents、commands、hooks、apps、scripts 与 assets**：保留在托管的上游 checkout 中，并登记到 `arsenal.json`。PHOENIX 不会仅因为某个 Codex hook 或 app 声明存在就执行它；不受支持的可执行 surface 保持惰性，不会静默获得 host 权限。

这种设计有意保持 capability-safe。安装武器库**不会**自动向每个插件授予浏览器、shell、文件系统、凭据或远程服务权限。

## 检查武器库

```powershell
corepack pnpm run dsh -- codex-plugin list
corepack pnpm run dsh -- codex-plugin inspect github
corepack pnpm run dsh -- codex-plugin doctor
corepack pnpm run dsh -- codex-plugin path
```

`list` 会显示每个插件的上游版本以及发现的 surface。`doctor` 会验证本地桥接，并且只按**名称**报告缺失的凭据环境变量；secret value 永远不会写入武器库索引或生成的 patch。

## 启用由 MCP 支撑的插件

```powershell
corepack pnpm run dsh -- codex-plugin enable github
```

已启用的 MCP 插件会合并到 `$DSH_HOME/codex/enabled.patch.yml`。PHOENIX launcher 会在下一次 profile 启动时自动追加这个 patch。若要在单次启动中绕过全部 Codex MCP 插件：

```powershell
$env:PHOENIX_CODEX_PLUGINS = 'off'
.\phoenix-windows.cmd
```

使用以下命令禁用单个 connector：

```powershell
corepack pnpm run dsh -- codex-plugin disable github
```

仅包含 skills 的插件不需要执行 `enable`；同步后的 skills 已经可通过正常的 PHOENIX skill catalog 使用。

## 身份验证与 secret

Codex 插件 MCP metadata 可以指定例如 `GITHUB_PAT_TOKEN` 的环境变量。PHOENIX 会保留该引用，并且仅在 runtime 解析。它绝不会把值复制到生成的 patch 或 `arsenal.json` 中。

不要盲目启用所有 MCP 插件。大量同时存在的 tool catalog 会占用模型上下文，并不必要地扩大权限范围。应同步完整武器库，然后只启用当前 workflow 真正需要的远程能力。

## 更新武器库

再次运行 `sync`。PHOENIX 会把托管的 `openai/plugins` checkout 快速更新到上游 `main`，重建 inventory 与 namespaced skills，重新生成 MCP patch，并为仍然暴露兼容 MCP server 的插件保留 enabled set。
