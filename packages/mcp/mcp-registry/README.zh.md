# MCP connector registry

[English](README.md) | 中文

`@phoenix-ai/dsh-mcp-connector-registry` 提供 `ctx.mcpConnectors`，用于记录 MCP server 的进程内生命周期状态和公开 tool 名称。

## Service contract

`McpConnectorRegistry.register()` 会拒绝重复的 server name，并返回可逆的 registration handle。`list()` 按注册顺序返回分离的快照，因此 client 可以发布 reconnect 状态而不会暴露可变的 service 内部对象。

挂载该 registry 时，随附的 MCP client 会使用它。没有该 registry 的最小 composition 仍保留现有的 MCP tool bridge 行为。

## Development

使用 `pnpm exec vitest run --config vitest.config.ts packages/mcp/mcp-registry/tests/registry.spec.ts` 运行该包的 focused test。

## Model Experience

### Connector lifecycle inventory

#### What the model sees

模型会看到每个 MCP server 的一项可审计状态，不会看到 transport secrets。

##### Status and data policy

```markdown
The model sees one auditable status per MCP server: starting, ready, disconnected, failed, or auth-required. The inventory carries only the server name, transport, stable reason code, and public tool names; configuration, credentials, URLs, headers, environment variables, and provider error text stay outside the model-facing projection.
```

#### Token effect

inventory 为每个注册的 MCP server 增加一行有界信息，不会把 transport 配置或 provider 错误文本复制到 request。

#### KV Cache effect

当 server identity、状态和公开 tool 名称不变时，inventory 保持 prefix-stable；生命周期变化只更新 inventory 行。

## Known Limitations and Deferred Work

- registry 只描述 tools 和 transport 状态；MCP resources 与 prompts 仍由未来的 capability consumers 管理。
