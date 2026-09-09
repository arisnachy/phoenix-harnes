# PHOENIX 的 Blender Lab MCP

[English](README.md) | 中文

这是 PHOENIX 中已纳入版本控制的集成，用于 Blender Foundation 的**官方 Blender Lab MCP server**。它不使用同名的无关第三方 PyPI 包 `blender-mcp`。

## 要求

- Blender **5.1 或更新版本**。
- 已从 Blender Lab 安装并在 Blender 中启用 MCP add-on。
- 在 add-on 需要时启用 Blender Online Access。
- PHOENIX 进程可用 `uv`/`uvx`。

Blender add-on 通常监听 `localhost:9876`。PHOENIX overlay 通过 stdio 启动 MCP 进程，并将其指向本地 Blender bridge。

overlay 将参数表达式保留为 YAML `!!js` block scalar，使其中的三元表达式仍作为可执行配置。keyless 集成测试通过真实 Loader 和本地 MCP fixture 验证命令及参数环境覆盖；它不会建立 live Blender connection。

## 使用 Blender MCP 启动 PHOENIX

通过 PHOENIX 已有的 launcher patch seam 加载随附的 overlay：

```sh
dsh --profile web --patch examples/mcp-blender/blender-lab.cordis.yml
```

对于无头 PHOENIX，请使用 headless profile 和同一 patch：

```sh
dsh --profile headless --patch examples/mcp-blender/blender-lab.cordis.yml
```

首次启动可能需要克隆并构建固定版本的 Blender Lab server。因此，overlay 允许 120 秒的启动预算，并在 Blender 暂时不可用时保持 PHOENIX 继续启动；MCP client 以有界退避重试。

连接后，工具会通过标准 PHOENIX MCP namespace 发布为：

```text
mcp__blender__<tool-name>
```

## 版本和 source pin

PHOENIX 启动：

```sh
uvx --from "git+https://projects.blender.org/lab/blender_mcp.git@v1.0.0#subdirectory=mcp" blender-mcp
```

这里使用明确的 Blender Lab Git URL 是有意的。**不要**将其简化为 `uvx blender-mcp`；该名称也属于另一个第三方项目，可能使服务器与 Blender Lab add-on 错误配对。

## 可选覆盖项

PHOENIX 接受以下启动前设置的环境变量：

- `PHOENIX_BLENDER_MCP_HOST` — 默认值为 `localhost`。
- `PHOENIX_BLENDER_MCP_PORT` — 默认值为 `9876`。
- `PHOENIX_BLENDER_MCP_COMMAND` — 默认值为 `uvx`；如果 GUI 启动无法解析 PATH，请设置 `uvx` 的绝对路径。
- `PHOENIX_BLENDER_MCP_ARGS` — 用于受控升级或本地镜像的 JSON 数组，会替换默认的 `uvx` 参数。

示例：

```sh
PHOENIX_BLENDER_MCP_HOST=localhost \
PHOENIX_BLENDER_MCP_PORT=9876 \
dsh --profile web --patch examples/mcp-blender/blender-lab.cordis.yml
```

## 安全边界

Blender Lab 明确警告，这个 MCP 集成可以在 Blender 中执行 LLM 生成的 Python，且没有防护。将 Blender 视为高影响执行面：使用已备份或测试场景工作，不要将敏感数据放在 Blender 主机上；处理不可信任务时，优先使用隔离工作站或 VM。

官方项目页面：https://www.blender.org/lab/mcp-server/
