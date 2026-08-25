from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"{path}: expected text not found")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Wire the scope planner already documented by the implemented Agent Note.
package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
scripts = package["scripts"]
scripts["phoenix:scope:plan"] = "tsx scripts/plan-phoenix-scope-migration.ts"
scripts["phoenix:scope:check"] = "tsx scripts/plan-phoenix-scope-migration.ts --check"
package_path.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

# This helper is no longer referenced by the updater; incremental activation builds in place.
Path("scripts/promote-client-artifacts.ts").unlink(missing_ok=True)

# README Model Experience grammar requires all prose after the H4 intro to belong to H5 examples.
readme = "packages/sandbox/sandbox-policy/README.md"
replace_once(
    readme,
    "One `sandbox:policy` contribution in the current runtime-context snapshot for every agent session. It does not enumerate mounted capabilities. Tool plugins retain operation and escalation guidance, approval policy contributes separately to the same snapshot, and plan guidance remains `dsh-plan-mode`'s system section. With launcher HARDNESS protection active, the same contribution states that the live PHOENIX runtime and data home are protected and directs self-modification to the isolated evolution worktree.",
    "One `sandbox:policy` contribution in the current runtime-context snapshot for every agent session. It does not enumerate mounted capabilities. Tool plugins retain operation and escalation guidance, approval policy contributes separately to the same snapshot, and plan guidance remains `dsh-plan-mode`'s system section. With launcher HARDNESS protection active, the same contribution states that the live PHOENIX runtime and data home are protected and directs self-modification to the isolated evolution worktree. The `danger-full-access` example is reachable only when launcher HARDNESS protection is absent; a protected launch resolves model-controlled full access to `workspace-write` before this context is rendered.",
)
replace_once(
    readme,
    "\nThe `danger-full-access` text is reachable only when launcher HARDNESS protection is absent. A protected PHOENIX launch resolves model-controlled full access to `workspace-write` before this context is rendered.\n",
    "\n",
)

readme_zh = "packages/sandbox/sandbox-policy/README.zh.md"
replace_once(
    readme_zh,
    "每个 agent 会话的当前运行时上下文快照中都有一项 `sandbox:policy` 贡献。它不枚举已装载的能力。工具插件继续负责操作与升权引导，批准策略单独贡献给同一份快照，计划引导仍由 `dsh-plan-mode` 的系统段落管理。启动器 HARDNESS 保护启用时，同一贡献还会说明 PHOENIX runtime 与数据目录受保护，并把自我修改指向隔离演化 worktree。",
    "每个 agent 会话的当前运行时上下文快照中都有一项 `sandbox:policy` 贡献。它不枚举已装载的能力。工具插件继续负责操作与升权引导，批准策略单独贡献给同一份快照，计划引导仍由 `dsh-plan-mode` 的系统段落管理。启动器 HARDNESS 保护启用时，同一贡献还会说明 PHOENIX runtime 与数据目录受保护，并把自我修改指向隔离演化 worktree。只有在启动器 HARDNESS 保护未启用时，模型才会看到 `danger-full-access` 示例；受保护的启动会在渲染此上下文之前把模型控制的完全访问解析为 `workspace-write`。",
)
replace_once(
    readme_zh,
    "\n只有在启动器 HARDNESS 保护未启用时，模型才会看到上述 `danger-full-access` 文本。受保护的 PHOENIX 启动会先把模型控制的完全访问解析为 `workspace-write`。\n",
    "\n",
)

# Record the alternatives behind the package-scope decision.
note = ".agents/notes/implemented/process/2026-08-24-phoenix-package-scope-migration.md"
replace_once(
    note,
    "\n## Consequences\n",
    "\n## Alternatives considered\n\n**Rename the complete namespace directly on `main`.** Rejected because manifests, imports, peer dependencies, generated Typert references, the lockfile, and built artifacts would move in one high-blast-radius operation with no inventory proving that the target identities are collision-free.\n\n**Keep the inherited namespace indefinitely.** Rejected because PHOENIX needs an owned package identity for a future coherent migration rather than permanent coupling to the upstream namespace.\n\n**Support both namespaces as standing aliases.** Rejected because a dual-scope runtime can hide incomplete migration work and let one process resolve mixed package identities. The migration should instead happen as a validated, coherent batch.\n\n## Consequences\n",
)
note_zh = ".agents/notes/implemented/process/2026-08-24-phoenix-package-scope-migration.zh.md"
replace_once(
    note_zh,
    "\n## 结果\n",
    "\n## 考虑过的替代方案\n\n**直接在 `main` 上一次性重命名完整命名空间。** 否决，因为 manifest、import、peer dependency、生成的 Typert 引用、lockfile 与构建产物会在一次高影响范围操作中同时移动，而事前没有清单能够证明目标身份不存在冲突。\n\n**永久保留继承的命名空间。** 否决，因为 PHOENIX 未来需要由自身拥有的包身份，并应通过一致迁移实现，而不是永久耦合到上游命名空间。\n\n**长期同时支持两个命名空间作为别名。** 否决，因为双 scope runtime 会掩盖未完成的迁移，并可能让同一进程解析到混合包身份。迁移应作为一个经过验证的一致批次完成。\n\n## 结果\n",
)

# Restore source-owned HARDNESS wording in type-equivalence docs.
for sandbox_doc in ("docs/subsystems/sandbox.md", "docs/subsystems/sandbox.zh.md"):
    p = Path(sandbox_doc)
    text = p.read_text(encoding="utf-8")
    old = "/** Explicit approved mode override, which outranks session policy. */"
    new = "/** Explicit approved mode override, which outranks session policy but not HARDNESS runtime protection. */"
    if old not in text:
        raise SystemExit(f"{sandbox_doc}: expected SandboxPolicyRequest JSDoc not found")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

# Add the missing reviewed Chinese counterpart for the Codex arsenal document.
arsenal = Path("docs/codex-plugin-arsenal.md")
arsenal_text = arsenal.read_text(encoding="utf-8")
if "[中文](codex-plugin-arsenal.zh.md)" not in arsenal_text:
    heading = "# PHOENIX Codex plugin arsenal\n"
    if heading not in arsenal_text:
        raise SystemExit("docs/codex-plugin-arsenal.md: heading not found")
    arsenal.write_text(
        arsenal_text.replace(heading, heading + "\nEnglish | [中文](codex-plugin-arsenal.zh.md)\n", 1),
        encoding="utf-8",
    )

Path("docs/codex-plugin-arsenal.zh.md").write_text(
    """# PHOENIX Codex 插件武器库

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
.\\phoenix-windows.cmd
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
""",
    encoding="utf-8",
)
