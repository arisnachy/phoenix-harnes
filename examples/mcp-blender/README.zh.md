# PHOENIX 的 Blender Lab MCP

[English](README.md) | 中文

这是 PHOENIX 内置的 **Blender Foundation 官方 Blender Lab MCP server** 集成。它不会使用那个同样名为 `blender-mcp`、但与 Blender Lab 无关的第三方 PyPI 包。

## 要求

- Blender **5.1 或更新版本**。
- 从 Blender Lab 安装 MCP add-on，并在 Blender 中启用。
- 当 add-on 需要时启用 Blender Online Access。
- PHOENIX 进程可以使用 `uv`/`uvx`。

Blender add-on 通常监听 `localhost:9876`。PHOENIX overlay 通过 stdio 启动 MCP 进程，并把它指向这个本地 Blender bridge。

## 使用 Blender MCP 启动 PHOENIX

通过 PHOENIX 现有的 launcher patch seam 加载随附 overlay：

```sh
dsh --profile web --patch examples/mcp-blender/blender-lab.cordis.yml
```

对于 headless PHOENIX，使用相同 patch 和 headless profile：

```sh
dsh --profile headless --patch examples/mcp-blender/blender-lab.cordis.yml
```

第一次启动可能需要克隆/构建固定版本的 Blender Lab server。因此 overlay 允许 120 秒启动预算，并且即使 Blender 本身暂时不可用也继续启动 PHOENIX；MCP client 会使用有界 backoff 重试。

连接后，工具通过普通 PHOENIX MCP namespace 发布为：

```text
mcp__blender__<tool-name>
```

## 版本和来源固定

PHOENIX 启动：

```sh
uvx --from "git+https://projects.blender.org/lab/blender_mcp.git@v1.0.0#subdirectory=mcp" blender-mcp
```

显式使用 Blender Lab Git URL 是有意的。**不要**简化为 `uvx blender-mcp`；这个名称也属于另一个第三方项目，可能会把错误的 server 与 Blender Lab add-on 配对。

## 可选覆盖

PHOENIX 在启动前接受以下环境变量：

- `PHOENIX_BLENDER_MCP_HOST` — 默认 `localhost`。
- `PHOENIX_BLENDER_MCP_PORT` — 默认 `9876`。
- `PHOENIX_BLENDER_MCP_COMMAND` — 默认 `uvx`；如果 GUI 启动无法解析 PATH，可设置绝对 `uvx` 路径。
- `PHOENIX_BLENDER_MCP_ARGS` — 替换默认 `uvx` 参数的 JSON 数组，用于受控升级或本地镜像。

示例：

```sh
PHOENIX_BLENDER_MCP_HOST=localhost \
PHOENIX_BLENDER_MCP_PORT=9876 \
dsh --profile web --patch examples/mcp-blender/blender-lab.cordis.yml
```

## 安全边界

Blender Lab 明确警告，这个 MCP 集成可以在没有 guard 的情况下在 Blender 内执行 LLM 生成的 Python。应把 Blender 视为高影响执行面：在有备份的测试场景上工作，不要把敏感数据放进 Blender host；处理不受信任务时优先使用隔离工作站或 VM。

官方项目页面：https://www.blender.org/lab/mcp-server/
