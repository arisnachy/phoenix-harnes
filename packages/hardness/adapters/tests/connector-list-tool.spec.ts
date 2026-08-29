import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationEntry, AuthorizationTelemetry } from '@phoenix-ai/dsh-authorization'
import type { McpConnectorEntry } from '@phoenix-ai/dsh-mcp-connector-registry'
import { credentialKey } from '@phoenix-ai/dsh-credentials'
import { createConnectorListTool } from '../src/connector-list-tool.ts'

function service(overrides: Partial<{
  list: () => readonly AuthorizationEntry[]
  inspect: (key: never) => Promise<AuthorizationTelemetry | undefined>
}> = {}) {
  return {
    list: overrides.list ?? (() => [{
      key: credentialKey('authorization-google', 'account'),
      label: 'Google Workspace',
      methods: [{ id: 'oauth', label: 'Sign in with Google' }],
      inFlight: false,
      disconnectable: true as const,
    }]),
    inspect: overrides.inspect ?? (async () => ({
      kind: 'account' as const,
      provider: 'google',
      email: 'private@example.com',
      connectors: [{
        id: 'drive',
        name: 'Google Drive',
        description: 'Files',
        category: 'Productivity',
        accessible: true,
        enabled: true,
        installed: true,
        callable: true,
      }],
    })),
  }
}

describe('connector_list tool', () => {
  it('projects connected services without leaking account identity or credential fields', async () => {
    const tool = createConnectorListTool(service())
    const result = await tool.execute({}, {
      signal: new AbortController().signal,
    } as never)

    expect(result).toEqual({
      kind: 'connector_list',
      connectors: [{
        id: 'authorization-google/account',
        label: 'Google Workspace',
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        status: 'connected',
        in_flight: false,
        disconnectable: true,
        services: [{
          id: 'drive',
          name: 'Google Drive',
          description: 'Files',
          category: 'Productivity',
          accessible: true,
          enabled: true,
          installed: true,
          callable: true,
        }],
      }],
    })
    expect(JSON.stringify(result)).not.toContain('private@example.com')
  })

  it('distinguishes an inspectable disconnected flow from a provider without telemetry', async () => {
    const tool = createConnectorListTool(service({ inspect: vi.fn(async () => undefined) }))
    await expect(tool.execute({}, {} as never)).resolves.toMatchObject({
      connectors: [{ status: 'not-connected', services: [] }],
    })

    const unknown = createConnectorListTool(service({ inspect: vi.fn(async () => { throw new Error('offline') }) }))
    await expect(unknown.execute({}, {} as never)).resolves.toMatchObject({
      connectors: [{ status: 'unknown', services: [] }],
    })
  })

  it('returns an empty inventory when no authorization flows are registered', async () => {
    const tool = createConnectorListTool(service({ list: () => [] }))
    await expect(tool.execute({}, {} as never)).resolves.toEqual({ kind: 'connector_list', connectors: [] })
  })

  it('merges ready and unavailable MCP state without exposing configuration', async () => {
    const entries: readonly McpConnectorEntry[] = [
      {
        serverName: 'github',
        transport: 'streamable-http',
        status: 'ready',
        toolNames: ['issues'],
      },
      {
        serverName: 'local',
        transport: 'stdio',
        status: 'disconnected',
        reasonCode: 'connection-lost',
        toolNames: ['files'],
      },
      {
        serverName: 'private',
        transport: 'streamable-http',
        status: 'auth-required',
        reasonCode: 'authorization-required',
        toolNames: [],
      },
    ]
    const tool = createConnectorListTool(undefined, { list: () => entries })
    const result = await tool.execute({}, {} as never)

    expect(result).toEqual({
      kind: 'connector_list',
      connectors: [
        {
          kind: 'mcp',
          id: 'mcp:github',
          label: 'MCP github',
          methods: [],
          status: 'ready',
          in_flight: false,
          services: [],
          transport: 'streamable-http',
          tools: ['issues'],
        },
        {
          kind: 'mcp',
          id: 'mcp:local',
          label: 'MCP local',
          methods: [],
          status: 'disconnected',
          in_flight: false,
          services: [],
          transport: 'stdio',
          tools: ['files'],
          reason_code: 'connection-lost',
        },
        {
          kind: 'mcp',
          id: 'mcp:private',
          label: 'MCP private',
          methods: [],
          status: 'auth-required',
          in_flight: false,
          services: [],
          transport: 'streamable-http',
          tools: [],
          reason_code: 'authorization-required',
        },
      ],
    })
    const rendered = JSON.stringify(result)
    expect(rendered).not.toContain('https://')
    expect(rendered).not.toContain('Authorization')
    expect(rendered).not.toContain('token')
  })

  it('registers the inventory with only the MCP registry', async () => {
    const tool = createConnectorListTool(undefined, { list: () => [] })
    await expect(tool.execute({}, {} as never)).resolves.toEqual({ kind: 'connector_list', connectors: [] })
  })
})
