# Blender Lab MCP for PHOENIX

English | [中文](README.zh.md)

This is PHOENIX's checked-in integration for the **official Blender Lab MCP server** from Blender Foundation. It does not use the unrelated third-party PyPI package that is also named `blender-mcp`.

## Requirements

- Blender **5.1 or newer**.
- The MCP add-on installed from Blender Lab and enabled in Blender.
- Blender Online Access enabled when required by the add-on.
- `uv`/`uvx` available to the PHOENIX process.

The Blender add-on normally listens on `localhost:9876`. The PHOENIX overlay starts the MCP process over stdio and points it at that local Blender bridge.

## Start PHOENIX with Blender MCP

Load the shipped overlay through PHOENIX's existing launcher patch seam:

```sh
dsh --profile web --patch examples/mcp-blender/blender-lab.cordis.yml
```

For headless PHOENIX, use the same patch with the headless profile:

```sh
dsh --profile headless --patch examples/mcp-blender/blender-lab.cordis.yml
```

The first launch may need to clone/build the pinned Blender Lab server. The overlay therefore allows a 120-second startup budget and keeps PHOENIX booting if Blender itself is temporarily unavailable; the MCP client retries with bounded backoff.

When connected, tools are published through the normal PHOENIX MCP namespace as:

```text
mcp__blender__<tool-name>
```

## Version and source pin

PHOENIX launches:

```sh
uvx --from "git+https://projects.blender.org/lab/blender_mcp.git@v1.0.2#subdirectory=mcp" blender-mcp
```

The explicit Blender Lab Git URL is intentional. Do **not** simplify it to `uvx blender-mcp`; that name also exists for a different third-party project and can pair the wrong server with Blender Lab's add-on.

## Optional overrides

PHOENIX accepts these environment variables before launch:

- `PHOENIX_BLENDER_MCP_HOST` — default `localhost`.
- `PHOENIX_BLENDER_MCP_PORT` — default `9876`.
- `PHOENIX_BLENDER_MCP_COMMAND` — default `uvx`; set an absolute `uvx` path if a GUI launch cannot resolve PATH.
- `PHOENIX_BLENDER_MCP_ARGS` — JSON array replacing the default `uvx` arguments, for controlled upgrades or local mirrors.

Example:

```sh
PHOENIX_BLENDER_MCP_HOST=localhost \
PHOENIX_BLENDER_MCP_PORT=9876 \
dsh --profile web --patch examples/mcp-blender/blender-lab.cordis.yml
```

## Security boundary

Blender Lab explicitly warns that this MCP integration can execute LLM-generated Python inside Blender without guards. Treat Blender as a high-impact execution surface: work on backed-up/test scenes, keep sensitive data out of the Blender host, and prefer an isolated workstation or VM for untrusted tasks.

Official project page: https://www.blender.org/lab/mcp-server/

## Recover Blender after a PHOENIX update (Windows)

1. Open **Settings → Connectors → Blender Lab · 3D real**. The connector now checks three *separate* local prerequisites: Blender, `uvx` and the add-on bridge on `localhost:9876`.
2. If Blender is detected but the add-on bridge is not listening, open Blender → Preferences → Extensions → Blender Lab MCP, enable the add-on, then select **Start MCP Server** (or the add-on's optional **Auto-start** setting).
3. If `uvx` is detected but the connector fails after a PHOENIX restart, use **Reconnect** or **Repair** in PHOENIX Settings. On Windows PHOENIX now checks verified paths such as `%USERPROFILE%\.local\bin\uvx.exe` even when the desktop process inherited a stale PATH.
4. If the connector was never installed in the persistent managed registry, choose **Install** on the Blender card. This is deliberately an explicit opt-in: Blender Lab executes model-generated Python code.
5. Confirm that the connector advertises `mcp__blender__*` tools and run one non-destructive scene-inspection action with Kira. An open TCP socket, an installed Blender executable or a ready MCP subprocess **alone** is not proof of a working Blender tool.

For local read-only diagnostics from the PHOENIX repository:

```sh
node scripts/phoenix-blender-diagnose.mjs
```

This check never installs a package, launches Blender or executes Python. The installed connector remains in PHOENIX's managed MCP overlay across supported updates; the Blender add-on must be running independently.

## 2026 Blender Lab SDK-compatibility repair

PHOENIX now pins Blender Lab MCP **v1.0.2**, which fixes its Python MCP SDK
dependency (`mcp<2`). The previous official `v1.0.0` can fail while
importing `mcp.server.fastmcp` when the unbounded SDK resolves v2.

**Existing connectors do not need to be deleted.** PHOENIX recognizes the
original official v1.0.0 managed entry and transparently launches the official
v1.0.2 executable. New managed installations and this sample overlay both
use v1.0.2.

This fixes a potential pre-handshake server crash. It does not start or enable
Blender's extension on its own. Blender's official architecture still requires:
- Blender 5.1 or newer and its MCP add-on installed from Blender Lab
- The "MCP Bridge Server" actually running in the extension preferences
- A functioning MCP stdio process that returns tools/list to PHOENIX

Official general setup: https://projects.blender.org/lab/blender_mcp/wiki/Setup
For a local checkout, the official Windows command is
`uv --directory C:\\blender_mcp\\mcp run blender-mcp` after explicitly
cloning the official repository. Do not substitute the unrelated PyPI
`blender-mcp` project. Neither a socket-open check nor a successful CLI
launch alone demonstrates that Kira can execute Blender tools.

If the connector still shows **connection-failed**, inspect the actual
Host stderr for `ModuleNotFoundError`, Git errors or a failed MCP handshake;
use **Reconnect** in PHOENIX once the update is installed.
