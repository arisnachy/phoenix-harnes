# PHOENIX Codex 插件武器库

[English](codex-plugin-arsenal.md) | 中文

PHOENIX 可以使用官方 Codex 插件市场，而无需把上游插件仓库 vendoring 到这个公共源码树中。

## `sync` 会安装什么

```powershell
corepack pnpm run dsh -- codex-plugin sync
```

该命令在 `$DSH_HOME/codex/openai-plugins` 下维护 `openai/plugins` 的托管检出，读取官方 marketplace 以及每个 `.codex-plugin/plugin.json`，然后构建本地 PHOENIX 武器库索引。

PHOENIX 按以下方式桥接受支持的 Codex 表面：

- **Skills**：复制到 `$DSH_HOME/skills`，并使用命名空间化的 `codex-*` skill 名称。现有 `@deepseek-ai/dsh-skill-filesystem` provider 会在下一次 catalog refresh/启动时发现它们。
- **MCP servers**：把每个插件的 `.mcp.json` 转换为 PHOENIX `@deepseek-ai/dsh-mcp-client` Cordis patch。除非用户明确启用，否则保持禁用。
- **Agents、commands、hooks、apps、scripts 和 assets**：保留在托管的上游检出中，并记录到 `arsenal.json`。PHOENIX 不会仅因为 Codex hook 或 app 声明存在就执行它；不受支持的可执行表面保持惰性，不会静默获得宿主权限。

这是有意的 capability-safe 设计。安装武器库**不会**自动把浏览器、shell、文件系统、凭据或远程服务权限授予所有插件。

## 检查武器库

```powershell
corepack pnpm run dsh -- codex-plugin list
corepack pnpm run dsh -- codex-plugin inspect github
corepack pnpm run dsh -- codex-plugin doctor
corepack pnpm run dsh -- codex-plugin path
```

`list` 显示每个插件的上游版本和发现的表面。`doctor` 验证本地桥接，并且只按**名称**报告缺失的凭据环境变量；secret value 永远不会写入武器库索引或生成的 patch。

## 启用 MCP-backed 插件

```powershell
corepack pnpm run dsh -- codex-plugin enable github
```

启用的 MCP 插件会合并到 `$DSH_HOME/codex/enabled.patch.yml`。PHOENIX launcher 会在下一次 profile boot 时自动追加该 patch。若要在一次启动中绕过全部 Codex MCP 插件：

```powershell
$env:PHOENIX_CODEX_PLUGINS = 'off'
.\phoenix-windows.cmd
```

禁用某个 connector：

```powershell
corepack pnpm run dsh -- codex-plugin disable github
```

只包含 skills 的插件不需要 `enable`；同步后的 skills 已经可以通过 PHOENIX 的正常 skill catalog 使用。

## 身份验证与 secrets

Codex 插件 MCP metadata 可以声明诸如 `GITHUB_PAT_TOKEN` 的环境变量。PHOENIX 保留该引用，并只在运行时解析它。它绝不会把实际值复制进生成的 patch 或 `arsenal.json`。

不要盲目启用所有 MCP 插件。过大的并发 tool catalog 会消耗模型上下文，并无谓扩大权限范围。可以同步完整武器库，但只启用当前 workflow 真正需要的远程能力。

## 更新武器库

再次运行 `sync`。PHOENIX 会快速更新托管的 `openai/plugins` 检出到上游 `main`，重建 inventory 与命名空间化 skills，重新生成 MCP patches，并为仍然提供兼容 MCP server 的插件保留启用集合。
