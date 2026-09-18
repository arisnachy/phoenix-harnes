import { describe, expect, it, vi } from 'vitest'
import type { McpConnectorEntry } from '@phoenix-ai/dsh-mcp-connector-registry'
import {
  createConnectorDiscoverTool,
  type McpRegistryCandidateView,
  type McpRegistryDiscoveryService,
} from '../src/connector-discover-tool.ts'

function candidate(
  name: string,
  status: McpRegistryCandidateView['status'] = 'active',
): McpRegistryCandidateView {
  return {
    name,
    title: name,
    description: `Tools for ${name}`,
    version: '1.0.0',
    status,
    trust: 'registry-listed',
    transports: ['streamable-http'],
    packages: [],
    remoteUrl: `https://mcp.example.com/${name.replaceAll('/', '-')}`,
    repositoryUrl: `https://github.com/example/${name.replaceAll('/', '-')}`,
  }
}

function registry(
  candidates: readonly McpRegistryCandidateView[],
  options: { stale?: boolean; fail?: boolean } = {},
): McpRegistryDiscoveryService & { searchMcpRegistry: ReturnType<typeof vi.fn> } {
  const searchMcpRegistry = vi.fn(async ({ query }: { query: string; limit?: number }) => {
    if (options.fail === true) throw new Error('registry offline')
    return {
      source: 'official-mcp-registry' as const,
      query,
      fetchedAt: '2026-09-18T12:00:00.000Z',
      stale: options.stale ?? false,
      candidates,
    }
  })
  return { searchMcpRegistry }
}

async function execute(
  tool: ReturnType<typeof createConnectorDiscoverTool>,
  args: { query: string; limit?: number },
): Promise<Record<string, unknown>> {
  return await tool.execute(args, { signal: new AbortController().signal } as never) as Record<string, unknown>
}

describe('connector_discover', () => {
  it('validates the query and requested result limit', async () => {
    const service = registry([])
    const tool = createConnectorDiscoverTool(undefined, service)

    await expect(tool.execute({ query: ' ' }, {} as never)).rejects.toThrow('at least 2 characters')
    await expect(tool.execute({ query: 'ok', limit: 0 }, {} as never)).rejects.toThrow('positive finite')
    await expect(tool.execute({ query: 'ok', limit: Number.POSITIVE_INFINITY }, {} as never)).rejects.toThrow('positive finite')

    await execute(tool, { query: ' default ' })
    expect(service.searchMcpRegistry).toHaveBeenLastCalledWith({ query: 'default', limit: 8 })

    await execute(tool, { query: 'large', limit: 99.9 })
    expect(service.searchMcpRegistry).toHaveBeenLastCalledWith({ query: 'large', limit: 12 })

    await execute(tool, { query: 'fractional', limit: 2.9 })
    expect(service.searchMcpRegistry).toHaveBeenLastCalledWith({ query: 'fractional', limit: 2 })
  })

  it('fails closed when the Host registry service is absent or rejects', async () => {
    expect(await execute(createConnectorDiscoverTool(), { query: 'calendar' })).toEqual({
      kind: 'connector_discovery',
      source: 'official-mcp-registry',
      query: 'calendar',
      registry_status: 'unavailable',
      message: 'Official MCP Registry search is unavailable in this Phoenix host. Do not substitute arbitrary GitHub MCP code automatically.',
      candidates: [],
    })

    expect(await execute(createConnectorDiscoverTool(undefined, registry([], { fail: true })), { query: 'calendar' }))
      .toEqual({
        kind: 'connector_discovery',
        source: 'official-mcp-registry',
        query: 'calendar',
        registry_status: 'unavailable',
        message: 'The Official MCP Registry could not be reached. Do not substitute arbitrary GitHub MCP code automatically.',
        candidates: [],
      })
  })

  it('proposes approval only for active/unknown missing servers and refuses deprecated/deleted installs', async () => {
    const service = registry([
      candidate('io.example/active', 'active'),
      candidate('io.example/unknown', 'unknown'),
      candidate('io.example/deprecated', 'deprecated'),
      candidate('io.example/deleted', 'deleted'),
    ], { stale: true })
    const result = await execute(createConnectorDiscoverTool(undefined, service), { query: 'example' })
    const rows = result.candidates as Array<Record<string, unknown>>

    expect(result).toMatchObject({
      source: 'official-mcp-registry',
      registry_status: 'ok',
      fetched_at: '2026-09-18T12:00:00.000Z',
      stale: true,
    })
    expect(rows.map(row => row.action)).toEqual([
      'install-with-user-approval',
      'review-source',
      'do-not-install',
      'do-not-install',
    ])
    expect(rows.every(row => row.trust === 'registry-listed')).toBe(true)
  })

  it('uses, authorizes, or repairs the already installed matching MCP instead of duplicating it', async () => {
    const service = registry([
      candidate('io.example/github'),
      candidate('io.example/notion'),
      candidate('prefix-io-example-slack'),
      candidate('io.example/acme-calendar'),
    ])
    const entries: McpConnectorEntry[] = [
      {
        serverName: 'github',
        transport: 'streamable-http',
        status: 'ready',
        toolNames: ['issues'],
      },
      {
        serverName: 'io-example-notion',
        transport: 'streamable-http',
        status: 'auth-required',
        reasonCode: 'authorization-required',
        toolNames: [],
      },
      {
        serverName: 'slack',
        transport: 'streamable-http',
        status: 'failed',
        reasonCode: 'retry-exhausted',
        toolNames: [],
      },
      {
        serverName: 'calendar',
        transport: 'stdio',
        status: 'disconnected',
        toolNames: [],
      },
    ]
    const result = await execute(createConnectorDiscoverTool({ list: () => entries }, service), { query: 'work' })
    const rows = result.candidates as Array<Record<string, unknown>>

    expect(rows[0]).toMatchObject({
      action: 'use',
      installedConnectorId: 'mcp:github',
      installedStatus: 'ready',
    })
    expect(rows[0]?.installedReasonCode).toBeUndefined()
    expect(rows[1]).toMatchObject({
      action: 'authorize',
      installedConnectorId: 'mcp:io-example-notion',
      installedStatus: 'auth-required',
      installedReasonCode: 'authorization-required',
    })
    expect(rows[2]).toMatchObject({
      action: 'repair',
      installedConnectorId: 'mcp:slack',
      installedReasonCode: 'retry-exhausted',
    })
    expect(rows[3]).toMatchObject({
      action: 'repair',
      installedConnectorId: 'mcp:calendar',
      installedStatus: 'disconnected',
    })
  })

  it('keeps package-only missing servers in source-review mode', async () => {
    const packageOnly = candidate('io.example/package-only')
    delete (packageOnly as { remoteUrl?: string }).remoteUrl
    const result = await execute(createConnectorDiscoverTool(undefined, registry([packageOnly])), { query: 'package' })
    expect(result.candidates).toEqual([
      expect.objectContaining({ action: 'review-source' }),
    ])
  })

  it('keeps unrelated installed connectors from matching registry candidates', async () => {
    const service = registry([candidate('io.example/calendar')])
    const entries: McpConnectorEntry[] = [{
      serverName: 'github',
      transport: 'streamable-http',
      status: 'ready',
      toolNames: [],
    }]
    const result = await execute(createConnectorDiscoverTool({ list: () => entries }, service), { query: 'calendar' })
    expect(result.candidates).toEqual([
      expect.objectContaining({ action: 'install-with-user-approval' }),
    ])
  })

  it('presents a stable search call card', () => {
    const tool = createConnectorDiscoverTool()
    expect(tool.presentCall?.({ query: 'calendar' } as never)).toEqual({
      card: 'generic',
      title: 'Official MCP Registry: calendar',
      kind: 'search',
      rawInput: 'calendar',
    })
  })
})
