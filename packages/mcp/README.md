# MCP — Model Context Protocol

English | [中文](README.zh.md)

Packages bridging the harness to the MCP ecosystem.

| Package | Role |
|---|---|
| [`mcp-registry/`](mcp-registry/README.md) | Secret-free lifecycle registry for MCP servers and public tools |
| [`mcp-client/`](mcp-client/README.md) | MCP client bridge that registers external server tools on `ctx.tools` |

## Official Blender Lab MCP

PHOENIX ships an opt-in connector for Blender's official Lab MCP server in the `standard` agent preset. It uses the generic `@phoenix-ai/dsh-mcp-client` over stdio and exposes discovered tools as `mcp__blender__<tool>`.

Prerequisites:

1. Install Blender 5.1 or newer.
2. Install and enable the official Blender Lab MCP add-on from https://www.blender.org/lab/mcp-server/.
3. Install the official MCP server from the Blender Lab source/setup instructions so the `blender-mcp` executable is available on `PATH`.
4. Start Blender with the MCP add-on enabled.
5. Set `PHOENIX_BLENDER_MCP_ENABLED=1` before starting PHOENIX.

If the official server executable lives elsewhere, set `PHOENIX_BLENDER_MCP_COMMAND` to its absolute path. The connector is disabled by default so machines without Blender do not pay a startup or reconnect cost.

Security: Blender Lab warns that its MCP integration can execute LLM-generated Python inside Blender without guards. Use it only in an environment whose files, credentials, and network access match that risk model.
