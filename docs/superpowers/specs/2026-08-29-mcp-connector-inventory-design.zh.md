# MCP 连接器清单设计

[English](2026-08-29-mcp-connector-inventory-design.md) | 中文

## 问题

PHOENIX 会在共享工具 registry 中暴露 MCP tools，但模型无法区分已连接、正在启动、已断开、重试中或永久失败的 server。authorization 清单只覆盖凭据获取流程，因此无法描述 transport 所拥有的 connector 状态，也无法报告 MCP server 当前提供的公开 tools。

## 决策

在 `ctx.mcpConnectors` 增加进程内 `McpConnectorRegistry` service。每个 MCP client 注册一个 server identity，并获得可撤销的句柄来更新状态和公开 tool。MCP connection supervisor 发布 `starting`、`ready`、`disconnected`、`failed` 和有证据支持的 `auth-required` 状态；重试期间保留已知的公开 tool 名称，最终失败后清除它们。registry 只包含 server name、transport、status、稳定的 reason code 和面向模型的公开 tool 名称。commands、URLs、headers、environment variables、credentials 和原始 provider errors 不会进入 registry。

扩展现有只读 `connector_list` tool，将 authorization flows 与 MCP registry entries 合并。authorization entries 保留当前经过清理的 telemetry projection。MCP entries 使用 `kind: mcp`，只暴露 transport 和公开 tool 名称，并且不会启动 connection、authorization flow 或 tool call。registry 和 inventory 对最小测试 context 仍然是可选的；发布的 base composition 会挂载 registry，使正常 MCP profiles 获得实时状态。

## 生命周期与失败语义

MCP client 在第一次连接尝试前发布 `starting`。连接成功并完成 tool synchronization 后发布 `ready`。已建立的连接丢失时发布 `disconnected`，此时 supervisor 可能继续重试。一次尝试失败时发布 `failed`；如果 Streamable HTTP transport 的错误带有明确的 HTTP 401 或 403 status，则发布 `auth-required`。重连会回到 `starting`；重试耗尽后发布 `failed` 并移除 server 的 tools。dispose client 会移除 registry entry。

## 验证

Unit tests 覆盖 registry duplicate protection、reversible registration、状态转换和清理后的 snapshots。MCP supervisor tests 覆盖 initial success、reconnect、final failure 和明确的 HTTP authorization failure。HARDNESS adapter tests 覆盖合并后的 authorization/MCP output、无 secret 字段和可撤销注册。keyless assembled snapshot 证明面向模型的 inventory schema 和 status vocabulary。

## 已考虑的替代方案

**从 `mcp__<server>__<tool>` 名称推断 server。** 拒绝，因为 tool 名称无法表示没有已发现 tools 的 server，也无法区分 reconnecting 和 failed 状态。

**让 authorization service 管理 MCP state。** 拒绝，因为 authorization 负责 credential acquisition，而 MCP 负责 transport 和 tool generations；合并会使其中一个生命周期不完整。

**向模型暴露 MCP configuration。** 拒绝，因为 commands、URLs、headers、environment variables 和 credentials 是部署数据，而不是安全的 connector status。

## 结果

模型可以依据当前且经过清理的 connection evidence 选择 MCP tool，并在 integration 不可用时解释原因，而不是从 tool error 中猜测。断开的 server 在有界恢复期间可能仍显示最近的 tool 名称，因此模型必须遵守 status，不能只因名称存在就认为 tool 可调用。没有 registry 的最小 composition 保持现有 MCP client behavior 和 tests；PHOENIX profile 则获得 authorization 与 MCP connector 的单一 inventory source。
