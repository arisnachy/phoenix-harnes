import type {
  AuthorizationEntry,
  AuthorizationService,
  AuthorizationTelemetry,
} from '@deepseek-ai/dsh-authorization'
import {
  defineTool,
  type JsonValue,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'

type ConnectorListService = Pick<AuthorizationService, 'list' | 'inspect'>

type ConnectorListResult = {
  kind: 'connector_list'
  connectors: {
    id: string
    label: string
    methods: { id: string; label: string }[]
    status: 'connected' | 'not-connected' | 'unknown'
    in_flight: boolean
    disconnectable?: true
    services: JsonValue[]
  }[]
}

function connectorStatus(telemetry: AuthorizationTelemetry | undefined, inspectable: boolean): ConnectorListResult['connectors'][number]['status'] {
  if (telemetry !== undefined) return 'connected'
  return inspectable ? 'not-connected' : 'unknown'
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
): Promise<ConnectorListResult['connectors'][number]> {
  let telemetry: AuthorizationTelemetry | undefined
  let inspectable = false
  try {
    telemetry = await authorization.inspect(entry.key)
    inspectable = true
  } catch {
    // Provider telemetry is optional. A failed inspection must not hide the
    // authorization flow or turn a read-only inventory call into a failure.
  }
  return {
    id: entry.key,
    label: entry.label,
    methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
    status: connectorStatus(telemetry, inspectable),
    in_flight: entry.inFlight,
    ...(entry.disconnectable === true ? { disconnectable: true as const } : {}),
    services: serviceViews(telemetry),
  }
}

/**
 * Create the model-facing, read-only connector inventory tool.
 * @param authorization - authorization service owning provider flows and safe telemetry.
 * @returns Tool definition that reports connector state without credential values.
 */
export function createConnectorListTool(authorization: ConnectorListService): ToolDefinition {
  return defineTool({
    name: 'connector_list',
    description: 'List authorized connectors and their callable services without changing access.',
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
                status: { type: 'string', enum: ['connected', 'not-connected', 'unknown'], required: true },
                in_flight: { type: 'boolean', required: true },
                disconnectable: { type: 'boolean' },
                services: { type: 'array', items: { type: 'json' }, required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      const entries = await Promise.all(authorization.list().map(entry => projectEntry(authorization, entry)))
      return { kind: 'connector_list', connectors: entries } satisfies ConnectorListResult
    },
    presentCall() {
      return { card: 'generic', title: 'Connector inventory', kind: 'execute', rawInput: 'connector_list' }
    },
  })
}
