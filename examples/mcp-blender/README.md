# Blender Lab MCP for PHOENIX

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
uvx --from "git+https://projects.blender.org/lab/blender_mcp.git@v1.0.0#subdirectory=mcp" blender-mcp
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
