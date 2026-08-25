# PHOENIX Codex plugin arsenal

English | [中文](codex-plugin-arsenal.zh.md)

PHOENIX can consume the official Codex plugin marketplace without vendoring the upstream plugin repository into this public source tree.

## What `sync` installs

```powershell
corepack pnpm run dsh -- codex-plugin sync
```

The command maintains a managed checkout of `openai/plugins` under `$DSH_HOME/codex/openai-plugins`, reads the official marketplace and each `.codex-plugin/plugin.json`, then builds a local PHOENIX arsenal index.

PHOENIX bridges supported Codex surfaces as follows:

- **Skills**: copied into `$DSH_HOME/skills` as namespaced `codex-*` skills. The existing `@deepseek-ai/dsh-skill-filesystem` provider discovers them on the next catalog refresh/boot.
- **MCP servers**: translated from each plugin's `.mcp.json` into PHOENIX `@deepseek-ai/dsh-mcp-client` Cordis patches. They stay disabled until explicitly enabled.
- **Agents, commands, hooks, apps, scripts, and assets**: retained in the managed upstream checkout and inventoried in `arsenal.json`. PHOENIX does not execute a Codex hook or app declaration merely because it exists; unsupported executable surfaces remain inert rather than silently receiving host authority.

This is intentionally capability-safe. Installing the arsenal does **not** grant browser, shell, filesystem, credentials, or remote-service authority to every plugin.

## Inspect the arsenal

```powershell
corepack pnpm run dsh -- codex-plugin list
corepack pnpm run dsh -- codex-plugin inspect github
corepack pnpm run dsh -- codex-plugin doctor
corepack pnpm run dsh -- codex-plugin path
```

`list` shows the upstream version and the surfaces found for every plugin. `doctor` verifies the local bridge and reports missing credential environment variables by **name only**; secret values are never written to the arsenal index or generated patches.

## Enable an MCP-backed plugin

```powershell
corepack pnpm run dsh -- codex-plugin enable github
```

Enabled MCP plugins are combined into `$DSH_HOME/codex/enabled.patch.yml`. The PHOENIX launcher automatically appends that patch on the next profile boot. To bypass all Codex MCP plugins for one launch:

```powershell
$env:PHOENIX_CODEX_PLUGINS = 'off'
.\phoenix-windows.cmd
```

Disable one connector with:

```powershell
corepack pnpm run dsh -- codex-plugin disable github
```

A plugin that contains only skills does not need `enable`; synchronized skills are already available through the normal PHOENIX skill catalog.

## Authentication and secrets

Codex plugin MCP metadata can name environment variables such as `GITHUB_PAT_TOKEN`. PHOENIX preserves the reference and resolves it only at runtime. It never copies the value into the generated patch or `arsenal.json`.

Do not enable every MCP plugin blindly. A large simultaneous tool catalog consumes model context and unnecessarily widens authority. Synchronize the complete arsenal, then enable the remote capabilities required by the current workflow.

## Updating the arsenal

Run `sync` again. PHOENIX fast-updates the managed `openai/plugins` checkout to upstream `main`, rebuilds the inventory and namespaced skills, regenerates MCP patches, and preserves the enabled set for plugins that still expose compatible MCP servers.
