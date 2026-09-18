import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpConnectorEntry } from '@phoenix-ai/dsh-mcp-connector-registry'
import { createConnectorDiscoverTool } from '../src/connector-discover-tool.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function registryResponse(name: string) {
  return new Response(JSON.stringify({
    servers: [{
      server: {
        name,
        title: 'Fixture MCP',
        description: 'Fixture connector for discovery tests.',
        version: '2.0.0',
        repository: { url: 'https://github.com/example/fixture-mcp' },
        remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/' }],
      },
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          status: 'active',
          isLatest: true,
        },
      },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function discover(
  query: string,
  entries: readonly McpConnectorEntry[],
): Promise<unknown> {
  vi.stubGlobal('fetch', vi.fn(async () => registryResponse(`io.example/${query}`)))
  const tool = createConnectorDiscoverTool({ list: () => entries })
  return tool.execute({ query }, {
    signal: new AbortController().signal,
  } as never)
}

describe('connector_discover', () => {
  it('offers registry-listed missing connectors for approval instead of auto-installing them', async () => {
    const result = await discover('phoenix-missing-fixture', [])

    expect(result).toMatchObject({
      kind: 'connector_discovery',
      source: 'official-mcp-registry',
      registry_status: 'ok',
      candidates: [{
        trust: 'registry-listed',
        action: 'install-with-user-approval',
        repository_url: 'https://github.com/example/fixture-mcp',
      }],
    })
  })

  it('turns an installed auth-required connector into an authorization action', async () => {
    const result = await discover('phoenix-auth-fixture', [{
      serverName: 'phoenix-auth-fixture',
      transport: 'streamable-http',
      status: 'auth-required',
      reasonCode: 'authorization-required',
      toolNames: [],
    }])

    expect(result).toMatchObject({
      candidates: [{
        action: 'authorize',
        installed_connector_id: 'mcp:phoenix-auth-fixture',
        installed_status: 'auth-required',
        installed_reason_code: 'authorization-required',
      }],
    })
  })

  it('uses a healthy installed connector rather than proposing another install', async () => {
    const result = await discover('phoenix-ready-fixture', [{
      serverName: 'phoenix-ready-fixture',
      transport: 'streamable-http',
      status: 'ready',
      toolNames: ['search'],
    }])

    expect(result).toMatchObject({
      candidates: [{
        action: 'use',
        installed_connector_id: 'mcp:phoenix-ready-fixture',
        installed_status: 'ready',
      }],
    })
  })

  it('does not silently fall back to arbitrary GitHub code when the official registry is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const tool = createConnectorDiscoverTool({ list: () => [] })
    const result = await tool.execute({ query: 'phoenix-offline-fixture' }, {
      signal: new AbortController().signal,
    } as never)

    expect(result).toEqual({
      kind: 'connector_discovery',
      source: 'official-mcp-registry',
      query: 'phoenix-offline-fixture',
      registry_status: 'unavailable',
      message: 'The Official MCP Registry could not be reached. Do not substitute arbitrary GitHub MCP code automatically.',
      candidates: [],
    })
  })
})
