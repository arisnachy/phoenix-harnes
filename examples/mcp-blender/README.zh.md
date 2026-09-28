# PHOENIX 的 Blender Lab MCP

[English](README.md) | 中文

这是 PHOENIX 内置的 **Blender Foundation 官方 Blender Lab MCP 服务器**集成。它不使用那个同样名为 `blender-mcp`、但与 Blender Lab 无关的第三方 PyPI 包。

## Requirements

- Blender **5.1 或更高版本**。
- 已从 Blender Lab 安装 MCP add-on，并在 Blender 中启用。
- 当 add-on 需要时，启用 Blender Online Access。
- PHOENIX 进程能够使用 `uv`/`uvx`。

Blender add-on 通常监听 `localhost:9876`。PHOENIX overlay 通过 stdio 启动 MCP 进程，并将其指向这个本地 Blender bridge。

## Start PHOENIX with Blender MCP

通过 PHOENIX 现有的 launcher patch seam 加载随附 overlay：

```sh
dsh --profile web --patch examples/mcp-blender/blender-lab.cordis.yml
```

对于 headless PHOENIX，使用同一个 patch 和 headless profile：

```sh
dsh --profile headless --patch examples/mcp-blender/blender-lab.cordis.yml
```

首次启动可能需要 clone/build 固定版本的 Blender Lab server。因此 overlay 提供 120 秒启动预算；即使 Blender 本身暂时不可用，PHOENIX 仍会继续启动，MCP client 会使用有界 backoff 重试。

连接成功后，工具会通过标准 PHOENIX MCP namespace 发布为：

```text
mcp__blender__<tool-name>
```

## Version and source pin

PHOENIX 启动：

```sh
uvx --from "git+https://projects.blender.org/lab/blender_mcp.git@v1.0.0#subdirectory=mcp" blender-mcp
```

显式使用 Blender Lab Git URL 是有意为之。**不要**简化成 `uvx blender-mcp`；该名称还对应另一个第三方项目，可能会把错误的 server 与 Blender Lab add-on 配对。

## Optional overrides

PHOENIX 在启动前接受这些环境变量：

- `PHOENIX_BLENDER_MCP_HOST` — 默认 `localhost`。
- `PHOENIX_BLENDER_MCP_PORT` — 默认 `9876`。
- `PHOENIX_BLENDER_MCP_COMMAND` — 默认 `uvx`；如果 GUI 启动时无法解析 PATH，可设置为 `uvx` 的绝对路径。
- `PHOENIX_BLENDER_MCP_ARGS` — JSON 数组，用于替换默认 `uvx` 参数，适用于受控升级或本地镜像。

示例：

```sh
PHOENIX_BLENDER_MCP_HOST=localhost \
PHOENIX_BLENDER_MCP_PORT=9876 \
dsh --profile web --patch examples/mcp-blender/blender-lab.cordis.yml
```

## Security boundary

Blender Lab 明确警告，此 MCP 集成可以在 Blender 内执行由 LLM 生成且没有 guard 的 Python。应把 Blender 视为高影响执行表面：使用有备份的测试场景，不要在 Blender host 中放置敏感数据；处理不受信任的任务时，优先使用隔离 workstation 或 VM。

官方项目页面：https://www.blender.org/lab/mcp-server/
