import type {
  AuthorizationEntry,
  AuthorizationService,
  AuthorizationTelemetry,
} from '@phoenix-ai/dsh-authorization'
import type { McpConnectorEntry, McpConnectorRegistry } from '@phoenix-ai/dsh-mcp-connector-registry'
import {
  defineTool,
  type JsonValue,
  type ToolDefinition,
} from '@phoenix-ai/dsh-tools'

type ConnectorListService = Pick<AuthorizationService, 'list' | 'inspect'>
type McpConnectorListService = Pick<McpConnectorRegistry, 'list'>
type AuthorizationStatus = 'connected' | 'not-connected' | 'unknown'
type ConnectorStatus = AuthorizationStatus | McpConnectorEntry['status']
type ConnectorRecommendedAction = 'use' | 'connect-or-reconnect' | 'wait' | 'repair' | 'inspect'
type AuthorizationConnector = {
  id: string
  label: string
  methods: { id: string; label: string }[]
  status: AuthorizationStatus
  recommended_action: ConnectorRecommendedAction
  in_flight: boolean
  disconnectable?: true
  services: JsonValue[]
}
type McpConnector = {
  kind: 'mcp'
  id: string
  label: string
  methods: []
  status: McpConnectorEntry['status']
  recommended_action: ConnectorRecommendedAction
  in_flight: false
  services: []
  transport: McpConnectorEntry['transport']
  tools: string[]
  reason_code?: NonNullable<McpConnectorEntry['reasonCode']>
}

type ConnectorListResult = {
  kind: 'connector_list'
  connectors: {
    id: string
    label: string
    methods: { id: string; label: string }[]
    status: ConnectorStatus
    recommended_action: ConnectorRecommendedAction
    in_flight: boolean
    disconnectable?: true
    services: JsonValue[]
    kind?: 'mcp'
    transport?: McpConnectorEntry['transport']
    tools?: string[]
    reason_code?: NonNullable<McpConnectorEntry['reasonCode']>
  }[]
}

function connectorStatus(telemetry: AuthorizationTelemetry | undefined, inspectable: boolean): AuthorizationStatus {
  if (telemetry !== undefined) return 'connected'
  return inspectable ? 'not-connected' : 'unknown'
}

function authorizationRecommendedAction(status: AuthorizationStatus): ConnectorRecommendedAction {
  if (status === 'connected') return 'use'
  if (status === 'not-connected') return 'connect-or-reconnect'
  return 'inspect'
}

function mcpRecommendedAction(status: McpConnectorEntry['status']): ConnectorRecommendedAction {
  if (status === 'ready') return 'use'
  if (status === 'auth-required') return 'connect-or-reconnect'
  if (status === 'starting') return 'wait'
  return 'repair'
}

function serviceViews(telemetry: AuthorizationTelemetry | undefined): JsonValue[] {
  if (telemetry?.kind !== 'account' || telemetry.connectors === undefined) return []
  return telemetry.connectors.map(connector => ({
    id: connector.id,
    name: connector.name,
    ...(connector.description === undefined ? {} : { description: connector.description }),
    ...(connector.category === undefined ? {} : { category: connector.category }),
    accessible: connector.accessible,
    enabled: connector.enabled,
    ...(connector.installed === undefined ? {} : { installed: connector.installed }),
    ...(connector.callable === undefined ? {} : { callable: connector.callable }),
  }))
}

async function projectEntry(
  authorization: ConnectorListService,
  entry: AuthorizationEntry,
): Promise<AuthorizationConnector> {
  let telemetry: AuthorizationTelemetry | undefined
  let inspectable = false
  try {
    telemetry = await authorization.inspect(entry.key)
    inspectable = true
  } catch {
    // Provider telemetry is optional. A failed inspection must not hide the
    // authorization flow or turn a read-only inventory call into a failure.
  }
  const status = connectorStatus(telemetry, inspectable)
  return {
    id: entry.key,
    label: entry.label,
    methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
    status,
    recommended_action: authorizationRecommendedAction(status),
    in_flight: entry.inFlight,
    ...(entry.disconnectable === true ? { disconnectable: true as const } : {}),
    services: serviceViews(telemetry),
  }
}

function projectMcpEntry(entry: McpConnectorEntry): McpConnector {
  return {
    kind: 'mcp',
    id: `mcp:${entry.serverName}`,
    label: `MCP ${entry.serverName}`,
    methods: [],
    status: entry.status,
    recommended_action: mcpRecommendedAction(entry.status),
    in_flight: false,
    services: [],
    transport: entry.transport,
    tools: [...entry.toolNames],
    ...(entry.reasonCode === undefined ? {} : { reason_code: entry.reasonCode }),
  }
}

/**
 * Create the model-facing, read-only connector inventory tool.
 * @param authorization - optional authorization service owning provider flows and safe telemetry.
 * @param mcpConnectors - optional registry owning secret-free MCP lifecycle state.
 * @returns Tool definition that reports connector state without credential values.
 */
export function createConnectorListTool(
  authorization?: ConnectorListService,
  mcpConnectors?: McpConnectorListService,
): ToolDefinition {
  return defineTool({
    name: 'connector_list',
    description: 'List installed/authorized connectors and callable services without changing access. Call this only when the needed connector is not already directly available, selection is ambiguous, or a connector just failed. Follow recommended_action: use, connect-or-reconnect, wait, repair, or inspect. Authorization failures must surface Connect/Reconnect instead of blind retries. If the needed connector is absent, call connector_discover.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'connector_list', required: true },
          connectors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', const: 'mcp' },
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                methods: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string', required: true },
                      label: { type: 'string', required: true },
                    },
                  },
                },
                status: {
                  type: 'string',
                  enum: ['connected', 'not-connected', 'unknown', 'starting', 'ready', 'disconnected', 'failed', 'auth-required'],
                  required: true,
                },
                recommended_action: {
                  type: 'string',
                  enum: ['use', 'connect-or-reconnect', 'wait', 'repair', 'inspect'],
                  required: true,
                },
                in_flight: { type: 'boolean', required: true },
                disconnectable: { type: 'boolean' },
                services: { type: 'array', items: { type: 'json' }, required: true },
                transport: { type: 'string', enum: ['stdio', 'streamable-http'] },
                tools: { type: 'array', items: { type: 'string' } },
                reason_code: {
                  type: 'string',
                  enum: ['connection-failed', 'connection-lost', 'authorization-required', 'retry-exhausted'],
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      const authorizationEntries = authorization === undefined
        ? []
        : await Promise.all(authorization.list().map(entry => projectEntry(authorization, entry)))
      const mcpEntries = mcpConnectors?.list().map(projectMcpEntry) ?? []
      const entries = [...authorizationEntries, ...mcpEntries]
      return { kind: 'connector_list', connectors: entries } satisfies ConnectorListResult
    },
    presentCall() {
      return { card: 'generic', title: 'Connector inventory', kind: 'execute', rawInput: 'connector_list' }
    },
  })
}
