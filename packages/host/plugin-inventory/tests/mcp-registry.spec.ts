import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchOfficialMcpRegistry } from '../src/mcp-registry.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Official MCP Registry proxy', () => {
  it('projects registry metadata without trusting unsafe external URLs', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://registry.modelcontextprotocol.io')
      expect(url.pathname).toBe('/v0.1/servers')
      expect(url.searchParams.get('search')).toBe('phoenix-registry-fixture')
      expect(url.searchParams.get('version')).toBe('latest')
      return new Response(JSON.stringify({
        servers: [{
          server: {
            name: 'io.example/calendar',
            title: 'Example Calendar',
            description: 'Calendar tools.',
            version: '1.2.3',
            repository: { url: 'https://github.com/example/calendar-mcp' },
            websiteUrl: 'javascript:alert(1)',
            remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/' }],
            packages: [{
              registryType: 'npm',
              identifier: '@example/calendar-mcp',
              version: '1.2.3',
              transport: { type: 'stdio' },
            }],
          },
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              status: 'active',
              isLatest: true,
            },
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchOfficialMcpRegistry({ query: 'phoenix-registry-fixture', limit: 7 })

    expect(result).toMatchObject({
      source: 'official-mcp-registry',
      query: 'phoenix-registry-fixture',
      stale: false,
      candidates: [{
        name: 'io.example/calendar',
        title: 'Example Calendar',
        status: 'active',
        trust: 'registry-listed',
        repositoryUrl: 'https://github.com/example/calendar-mcp',
        remoteUrl: 'https://mcp.example.com/',
        transports: ['streamable-http', 'stdio'],
      }],
    })
    expect(result.candidates[0]?.websiteUrl).toBeUndefined()
    expect(result.candidates[0]?.packages).toEqual([{
      registryType: 'npm',
      identifier: '@example/calendar-mcp',
      version: '1.2.3',
      transport: 'stdio',
    }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the registry response is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })))

    await expect(searchOfficialMcpRegistry({ query: 'phoenix-malformed-fixture' }))
      .rejects.toThrow('Official MCP Registry lookup failed')
  })
})
