import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchOfficialMcpRegistry } from '../src/mcp-registry.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function response(servers: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ servers }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function activeServer(name: string): Record<string, unknown> {
  return {
    server: {
      name,
      title: name,
      description: `Tools for ${name}`,
      version: '1.0.0',
      repository: { url: `https://github.com/example/${name}` },
      remotes: [{ type: 'streamable-http', url: `https://mcp.example.com/${name}` }],
    },
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        status: 'active',
        isLatest: true,
      },
    },
  }
}

describe('Official MCP Registry proxy', () => {
  it('projects every supported transport and sanitizes malformed/untrusted metadata', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://registry.modelcontextprotocol.io')
      expect(url.pathname).toBe('/v0.1/servers')
      expect(url.searchParams.get('search')).toBe('projection-fixture')
      expect(url.searchParams.get('limit')).toBe('7')
      expect(url.searchParams.get('version')).toBe('latest')
      return response([
        null,
        [],
        3,
        {},
        { server: null },
        { server: { description: 'missing name', version: '1' } },
        { server: { name: 'missing-description', version: '1' } },
        { server: { name: 'missing-version', description: 'x' } },
        {
          server: {
            name: 'io.example/minimal',
            description: 'Minimal server.',
            version: '0.1.0',
            websiteUrl: 'http://insecure.example.com/',
            remotes: 'not-an-array',
          },
        },
        {
          server: {
            name: 'io.example/full',
            title: 'Full MCP',
            description: 'Full server.',
            version: '2.0.0',
            repository: { url: 'https://github.com/example/full-mcp' },
            websiteUrl: 'not a url',
            packages: [
              null,
              {},
              { registryType: 'npm' },
              { registryType: 'npm', identifier: '@example/missing-transport' },
              { registryType: 'npm', identifier: '@example/bad', transport: { type: 'bogus' } },
              { registryType: 'npm', identifier: '@example/stdio', transport: { type: 'stdio' } },
              {
                registryType: 'pypi',
                identifier: 'example-sse',
                version: '2.0.0',
                runtimeHint: 'python',
                transport: { type: 'sse' },
              },
              {
                registryType: 'npm',
                identifier: '@example/http',
                version: '2.0.0',
                runtimeHint: 'node',
                transport: { type: 'streamable-http' },
              },
            ],
            remotes: [
              null,
              { type: 'bogus' },
              { type: 'sse', url: 'https://events.example.com/' },
              { type: 'streamable-http', url: 'javascript:alert(1)' },
              { type: 'streamable-http', url: 'https://templated.example.com/{tenant}' },
              { type: 'streamable-http', url: 'https://mcp.example.com/full' },
              { type: 'streamable-http', url: 'https://ignored.example.com/second' },
            ],
          },
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              status: 'deprecated',
            },
          },
        },
        {
          server: {
            name: 'io.example/deleted',
            description: 'Deleted server.',
            version: '1.0.0',
            packages: [],
          },
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              status: 'deleted',
            },
          },
        },
        {
          server: {
            name: 'io.example/blank-status',
            description: 'Unknown status.',
            version: '1.0.0',
          },
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              status: '   ',
            },
          },
        },
      ])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchOfficialMcpRegistry({ query: ' projection-fixture ', limit: 7.8 })

    expect(result.source).toBe('official-mcp-registry')
    expect(result.stale).toBe(false)
    expect(result.candidates).toHaveLength(4)
    expect(result.candidates[0]).toEqual({
      name: 'io.example/minimal',
      title: 'io.example/minimal',
      description: 'Minimal server.',
      version: '0.1.0',
      status: 'unknown',
      trust: 'registry-listed',
      transports: [],
      packages: [],
    })
    expect(result.candidates[1]).toEqual({
      name: 'io.example/full',
      title: 'Full MCP',
      description: 'Full server.',
      version: '2.0.0',
      status: 'deprecated',
      trust: 'registry-listed',
      transports: ['sse', 'streamable-http', 'stdio'],
      packages: [
        {
          registryType: 'npm',
          identifier: '@example/stdio',
          transport: 'stdio',
        },
        {
          registryType: 'pypi',
          identifier: 'example-sse',
          transport: 'sse',
          version: '2.0.0',
          runtimeHint: 'python',
        },
        {
          registryType: 'npm',
          identifier: '@example/http',
          transport: 'streamable-http',
          version: '2.0.0',
          runtimeHint: 'node',
        },
      ],
      repositoryUrl: 'https://github.com/example/full-mcp',
      remoteUrl: 'https://mcp.example.com/full',
    })
    expect(result.candidates[2]?.status).toBe('deleted')
    expect(result.candidates[3]?.status).toBe('unknown')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes limits, validates requests, and serves a fresh cache without another fetch', async () => {
    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (input: string | URL) => {
      requestedUrls.push(String(input))
      return response([activeServer('cached')])
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchOfficialMcpRegistry({ query: 'x' })).rejects.toThrow('at least 2 characters')
    await expect(searchOfficialMcpRegistry({ query: 'valid', limit: Number.NaN })).rejects.toThrow('must be finite')

    const first = await searchOfficialMcpRegistry({ query: 'cache-fixture' })
    const cached = await searchOfficialMcpRegistry({ query: 'CACHE-FIXTURE', limit: 12 })
    expect(cached).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await searchOfficialMcpRegistry({ query: 'low-limit-fixture', limit: -5 })
    expect(new URL(requestedUrls.at(-1)!).searchParams.get('limit')).toBe('1')

    await searchOfficialMcpRegistry({ query: 'high-limit-fixture', limit: 200 })
    expect(new URL(requestedUrls.at(-1)!).searchParams.get('limit')).toBe('20')
  })

  it('returns a stale cached snapshot during a short registry outage, then fails after the stale horizon', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => response([activeServer('stale')]))
      .mockImplementationOnce(async () => { throw new Error('temporary outage') })
      .mockImplementationOnce(async () => { throw 'long outage' })
    vi.stubGlobal('fetch', fetchMock)

    const first = await searchOfficialMcpRegistry({ query: 'stale-fixture' })
    now += 5 * 60 * 1000 + 1
    const stale = await searchOfficialMcpRegistry({ query: 'stale-fixture' })
    expect(stale).toEqual({ ...first, stale: true })

    now += 24 * 60 * 60 * 1000 + 1
    await expect(searchOfficialMcpRegistry({ query: 'stale-fixture' }))
      .rejects.toThrow('Official MCP Registry lookup failed: long outage')
  })

  it('fails closed for HTTP and malformed registry responses', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => new Response('down', { status: 503 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify([]), { status: 200 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchOfficialMcpRegistry({ query: 'http-error-fixture' }))
      .rejects.toThrow('registry returned HTTP 503')
    await expect(searchOfficialMcpRegistry({ query: 'array-payload-fixture' }))
      .rejects.toThrow('invalid server list')
    await expect(searchOfficialMcpRegistry({ query: 'missing-list-fixture' }))
      .rejects.toThrow('invalid server list')
  })

  it('keeps the cache bounded by evicting old search entries', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const query = new URL(String(input)).searchParams.get('search') ?? 'unknown'
      return response([activeServer(query)])
    })
    vi.stubGlobal('fetch', fetchMock)

    for (let index = 0; index < 70; index++) {
      await searchOfficialMcpRegistry({ query: `eviction-fixture-${String(index).padStart(2, '0')}` })
    }
    const callsBefore = fetchMock.mock.calls.length
    await searchOfficialMcpRegistry({ query: 'eviction-fixture-00' })
    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1)
  })
})
