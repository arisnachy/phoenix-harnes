import type { Context } from '@deepseek-ai/cordis'
import type { McpConnectorRegistry } from '@deepseek-ai/dsh-mcp-connector-registry'

export const name = 'connector-inventory-fixture'
export const inject = ['mcpConnectors']

/** Mount one deterministic public MCP row for the assembled keyless snapshot. */
export function apply(ctx: Context): void {
  const registry = ctx.get('mcpConnectors') as McpConnectorRegistry
  const registration = registry.register({ serverName: 'fixture', transport: 'stdio' })
  registration.setTools(['search'])
  registration.setStatus('ready')
}
