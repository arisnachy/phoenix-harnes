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
  requested_target?: string
  has_relevant_match?: boolean
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
    relevant?: boolean
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

const GENERIC_TARGET_TOKENS = new Set([
  'connector', 'connectors', 'service', 'services', 'tool', 'tools', 'mcp',
  'email', 'mail', 'calendar', 'file', 'files', 'storage', 'drive',
  'hosting', 'host', 'domain', 'domains', 'design', 'code', 'repo', 'repository',
])

function targetTokens(value: string): string[] {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 2)
}

function relevantToTarget(
  connector: ConnectorListResult['connectors'][number],
  target: string,
): boolean {
  const requested = targetTokens(target)
  if (requested.length === 0) return false
  const specific = requested.filter(token => !GENERIC_TARGET_TOKENS.has(token))
  const required = specific.length > 0 ? specific : requested
  const searchable = targetTokens(JSON.stringify(connector))
  const haystack = new Set(searchable)
  return required.every(token => haystack.has(token))
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
    description: 'List installed/authorized connectors and callable services without changing access. When the user names a service or capability, pass that concise name in target so PHOENIX can mark only task-relevant connectors. Results returned without target are inventory-only and must never trigger a user-facing Connect/Reconnect action; re-call with target first. Call this only when the needed connector is not already directly available, selection is ambiguous, or a connector just failed. Follow recommended_action: use, connect-or-reconnect, wait, repair, or inspect. Never surface an unrelated connector merely because it needs authorization. If target has no relevant match, call connector_discover for that target.',
    parameters: {
      target: { type: 'string' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'connector_list', required: true },
          requested_target: { type: 'string' },
          has_relevant_match: { type: 'boolean' },
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
                relevant: { type: 'boolean' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const authorizationEntries = authorization === undefined
        ? []
        : await Promise.all(authorization.list().map(entry => projectEntry(authorization, entry)))
      const mcpEntries = mcpConnectors?.list().map(projectMcpEntry) ?? []
      const entries = [...authorizationEntries, ...mcpEntries]
      const target = args.target?.trim()
      if (target === undefined || target.length === 0) {
        return { kind: 'connector_list', connectors: entries } satisfies ConnectorListResult
      }
      const connectors = entries.map(connector => ({
        ...connector,
        relevant: relevantToTarget(connector, target),
      }))
      return {
        kind: 'connector_list',
        requested_target: target,
        has_relevant_match: connectors.some(connector => connector.relevant),
        connectors,
      } satisfies ConnectorListResult
    },
    presentCall(args) {
      const target = args.target?.trim()
      return {
        card: 'generic',
        title: target === undefined || target.length === 0 ? 'Connector inventory' : `Connector: ${target}`,
        kind: 'execute',
        rawInput: target ?? 'connector_list',
      }
    },
  })
}
