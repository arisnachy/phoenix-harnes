# MCP connector registry

English | [中文](README.zh.md)

The `@deepseek-ai/dsh-mcp-connector-registry` package provides `ctx.mcpConnectors`, a process-local inventory of MCP server lifecycle state and public tool names.

## Service contract

`McpConnectorRegistry.register()` rejects duplicate server names and returns a reversible registration handle. `list()` returns detached snapshots in registration order, so a client can publish reconnect state without exposing mutable service internals.

The shipped MCP client uses this registry when it is mounted. Minimal compositions may omit it and retain the existing MCP tool bridge behavior.

## Development

Run the focused package test with `pnpm exec vitest run --config vitest.config.ts packages/mcp/mcp-registry/tests/registry.spec.ts`.

## Model Experience

### Connector lifecycle inventory

#### What the model sees

The model sees one auditable status per MCP server and no transport secrets.

##### Status and data policy

```markdown
The model sees one auditable status per MCP server: starting, ready, disconnected, failed, or auth-required. The inventory carries only the server name, transport, stable reason code, and public tool names; configuration, credentials, URLs, headers, environment variables, and provider error text stay outside the model-facing projection.
```

#### Token effect

The inventory adds one bounded row per registered MCP server and does not copy transport configuration or provider error text into the request.

#### KV Cache effect

The inventory is prefix-stable while server identities, statuses, and public tool names remain unchanged; lifecycle transitions change only the inventory row.

## Known Limitations and Deferred Work

- The registry describes tools and transport state only; MCP resources and prompts remain owned by future capability consumers.
