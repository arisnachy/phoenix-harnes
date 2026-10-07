import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManagedMcpController,
  MANAGED_MCP_INJECT,
  managedMcpPatchPath,
  type ManagedMcpLoader,
  type ManagedMcpRegistrySearch,
} from '../src/mcp-managed.ts'
import type { McpRegistryCandidate, McpRegistrySearchSnapshot } from '../src/types.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function tempPatch(): string {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-managed-mcp-'))
  roots.push(root)
  return join(root, 'nested', 'managed.patch.yml')
}

function candidate(overrides: Partial<McpRegistryCandidate> = {}): McpRegistryCandidate {
  return {
    name: 'io.example/calendar',
    title: 'Calendar',
    description: 'Calendar tools.',
    version: '1.0.0',
    status: 'active',
    trust: 'registry-listed',
    icons: [],
    transports: ['streamable-http'],
    packages: [],
    remoteUrl: 'https://mcp.example.com/calendar',
    ...overrides,
  }
}

function registry(values: readonly McpRegistryCandidate[]): ManagedMcpRegistrySearch & ReturnType<typeof vi.fn> {
  return vi.fn(async ({ query }: { query: string; limit?: number }): Promise<McpRegistrySearchSnapshot> => ({
    source: 'official-mcp-registry',
    query,
    fetchedAt: '2026-09-18T12:00:00.000Z',
    stale: false,
    candidates: values,
  }))
}

function loader(options: { createError?: Error; updateError?: Error; removeError?: Error } = {}): ManagedMcpLoader & {
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
} {
  return {
    create: vi.fn(async () => {
      if (options.createError !== undefined) throw options.createError
      return 'live-entry-id'
    }),
    update: vi.fn(async () => {
      if (options.updateError !== undefined) throw options.updateError
    }),
    remove: vi.fn(async () => {
      if (options.removeError !== undefined) throw options.removeError
    }),
  }
}

describe('ManagedMcpController', () => {
  it('starts empty, installs a verified remote, persists it, and remains idempotent', async () => {
    const patchPath = tempPatch()
    const search = registry([candidate()])
    const live = loader()
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: search })

    await expect(controller.snapshot()).resolves.toEqual([])
    const installed = await controller.install({ name: ' io.example/calendar ', version: '1.0.0' })
    expect(installed).toMatchObject({
      status: 'installed',
      connector: {
        entryId: 'live-entry-id',
        url: 'https://mcp.example.com/calendar',
        source: { kind: 'registry', name: 'io.example/calendar', version: '1.0.0' },
      },
    })
    expect(installed.connector.serverName).toMatch(/^calendar-[a-f0-9]{7}$/)
    expect(search).toHaveBeenCalledWith({ query: 'io.example/calendar', limit: 20 })
    expect(live.create).toHaveBeenCalledWith({
      name: '@phoenix-ai/dsh-mcp-client',
      inject: [...MANAGED_MCP_INJECT],
      config: {
        transport: 'streamable-http',
        serverName: installed.connector.serverName,
        url: 'https://mcp.example.com/calendar',
        headers: {},
        oauth: true,
      },
    })
    const persisted = JSON.parse(readFileSync(patchPath, 'utf8')) as unknown[]
    expect(persisted).toHaveLength(1)
    await expect(controller.snapshot()).resolves.toEqual([{
      entryId: 'live-entry-id',
      serverName: installed.connector.serverName,
      url: 'https://mcp.example.com/calendar',
      source: { kind: 'registry', name: 'io.example/calendar', version: '1.0.0' },
    }])

    await expect(controller.install({ name: 'io.example/calendar' })).resolves.toMatchObject({
      status: 'already-installed',
      connector: { entryId: 'live-entry-id' },
    })
    expect(live.create).toHaveBeenCalledTimes(1)
  })

  it('installs, persists, and repairs the pinned official Devpost Hackathons MCP', async () => {
    const patchPath = tempPatch()
    const live = loader()
    live.create
      .mockResolvedValueOnce('devpost-entry')
      .mockResolvedValueOnce('devpost-repaired')
    const search = registry([])
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: search })

    const installed = await controller.installDevpostHackathons()
    expect(installed).toEqual({
      status: 'installed',
      connector: {
        entryId: 'devpost-entry',
        serverName: 'devpost',
        url: 'https://devpost.com/mcp',
        source: { kind: 'curated', connectorId: 'devpost' },
      },
    })
    expect(live.create).toHaveBeenCalledWith({
      name: '@phoenix-ai/dsh-mcp-client',
      inject: [...MANAGED_MCP_INJECT],
      config: {
        transport: 'streamable-http',
        serverName: 'devpost',
        url: 'https://devpost.com/mcp',
        headers: {},
        oauth: true,
      },
    })
    expect(search).not.toHaveBeenCalled()
    expect(readFileSync(patchPath, 'utf8')).toContain('https://devpost.com/mcp')

    await expect(controller.installDevpostHackathons()).resolves.toMatchObject({
      status: 'already-installed',
      connector: { entryId: 'devpost-entry' },
    })
    expect(live.create).toHaveBeenCalledTimes(1)

    const repaired = await controller.repair({ entryId: 'devpost-entry' })
    expect(live.remove).toHaveBeenCalledWith('devpost-entry')
    expect(repaired).toMatchObject({
      status: 'installed',
      connector: {
        entryId: 'devpost-repaired',
        serverName: 'devpost',
        url: 'https://devpost.com/mcp',
        source: { kind: 'curated', connectorId: 'devpost' },
      },
    })
    expect(search).not.toHaveBeenCalled()

    await expect(controller.removeDevpostHackathons()).resolves.toBe(true)
    expect(live.remove).toHaveBeenCalledWith('devpost-repaired')
    await expect(controller.snapshot()).resolves.toEqual([])
  })


  it('installs, persists, repairs, and removes Canva\'s pinned official MCP', async () => {
    const patchPath = tempPatch()
    const live = loader()
    live.create
      .mockResolvedValueOnce('canva-entry')
      .mockResolvedValueOnce('canva-repaired')
    const search = registry([])
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: search })

    const installed = await controller.installCanva()
    expect(installed).toEqual({
      status: 'installed',
      connector: {
        entryId: 'canva-entry',
        serverName: 'canva',
        url: 'https://mcp.canva.com/mcp',
        source: { kind: 'curated', connectorId: 'canva' },
      },
    })
    expect(live.create).toHaveBeenCalledWith({
      name: '@phoenix-ai/dsh-mcp-client',
      inject: [...MANAGED_MCP_INJECT],
      config: {
        transport: 'streamable-http',
        serverName: 'canva',
        url: 'https://mcp.canva.com/mcp',
        headers: {},
        oauth: true,
        toolCallTimeoutMs: 60_000,
        startupTimeoutMs: 5_000,
        failOnStartupError: false,
      },
    })
    expect(search).not.toHaveBeenCalled()
    expect(readFileSync(patchPath, 'utf8')).toContain('https://mcp.canva.com/mcp')

    await expect(controller.installCanva()).resolves.toMatchObject({
      status: 'already-installed',
      connector: { entryId: 'canva-entry' },
    })
    expect(live.create).toHaveBeenCalledTimes(1)

    const repaired = await controller.repair({ entryId: 'canva-entry' })
    expect(live.remove).toHaveBeenCalledWith('canva-entry')
    expect(repaired).toMatchObject({
      status: 'installed',
      connector: {
        entryId: 'canva-repaired',
        serverName: 'canva',
        url: 'https://mcp.canva.com/mcp',
        source: { kind: 'curated', connectorId: 'canva' },
      },
    })
    expect(search).not.toHaveBeenCalled()

    await expect(controller.removeCanva()).resolves.toBe(true)
    expect(live.remove).toHaveBeenCalledWith('canva-repaired')
    await expect(controller.snapshot()).resolves.toEqual([])
  })

  it('restores the Phoenix core MCP pack with pinned remotes and local runners', async () => {
    const patchPath = tempPatch()
    type CreateOptions = Parameters<ManagedMcpLoader['create']>[0]
    const created: CreateOptions[] = []
    const live: ManagedMcpLoader = {
      create(options) {
        created.push(options)
        return Promise.resolve(`entry-${options.config.serverName}`)
      },
      update() {
        return Promise.resolve()
      },
      remove() {
        return Promise.resolve()
      },
    }
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: registry([]) })

    const restored = await controller.ensureCoreMcpPack()
    expect(restored.failed).toEqual([])
    expect(restored.installed).toEqual(expect.arrayContaining([
      'canva', 'supabase', 'heygen', 'figma', 'notion', 'linear', 'cloudflare', 'slack',
      'brave-search', 'filesystem', 'memory', 'fetch',
    ]))
    expect(restored.installed).not.toContain('devpost')

    expect(created.every(options =>
      JSON.stringify(options.inject) === JSON.stringify(MANAGED_MCP_INJECT))).toBe(true)
    const configs = new Map(created.map(({ config }) => [config.serverName, config]))
    expect(configs.get('supabase')).toMatchObject({
      transport: 'streamable-http',
      serverName: 'supabase',
      url: 'https://mcp.supabase.com/mcp',
      oauth: true,
    })
    expect(configs.get('heygen')).toMatchObject({
      transport: 'streamable-http',
      serverName: 'heygen',
      url: 'https://mcp.heygen.com/mcp/v1/',
      oauth: true,
    })
    expect(configs.get('figma')).toMatchObject({
      transport: 'streamable-http',
      serverName: 'figma',
      url: 'http://127.0.0.1:3845/mcp',
      oauth: false,
    })
    expect(configs.get('slack')).toMatchObject({
      transport: 'streamable-http',
      serverName: 'slack',
      url: 'https://mcp.slack.com/mcp',
      oauth: true,
      oauthClientIdRef: 'SLACK_MCP_CLIENT_ID',
      oauthClientSecretRef: 'SLACK_MCP_CLIENT_SECRET',
      oauthCallbackPort: 17844,
      oauthTokenEndpointAuthMethod: 'client_secret_post',
    })
    expect(configs.get('brave-search')).toMatchObject({
      transport: 'stdio',
      serverName: 'brave-search',
      command: 'npx',
      envCredentialRefs: { BRAVE_API_KEY: 'BRAVE_API_KEY' },
    })
    expect(configs.get('filesystem')).toMatchObject({
      transport: 'stdio',
      serverName: 'filesystem',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    })
    expect(configs.get('fetch')).toMatchObject({
      transport: 'stdio',
      serverName: 'fetch',
      command: 'uvx',
      args: ['mcp-server-fetch'],
    })

    const snapshot = await controller.snapshot()
    expect(snapshot).toHaveLength(restored.installed.length)
    expect(snapshot).toEqual(expect.arrayContaining([
      expect.objectContaining({
        serverName: 'linear',
        url: 'https://mcp.linear.app/mcp',
        source: { kind: 'curated', connectorId: 'linear' },
      }),
      expect.objectContaining({
        serverName: 'figma',
        url: 'http://127.0.0.1:3845/mcp',
        source: { kind: 'curated', connectorId: 'figma' },
      }),
      expect.objectContaining({
        serverName: 'memory',
        url: 'stdio://memory',
        source: { kind: 'curated', connectorId: 'memory' },
      }),
    ]))

    const second = await controller.ensureCoreMcpPack()
    expect(second.installed).toEqual([])
    expect(second.alreadyInstalled).toEqual(expect.arrayContaining([...restored.installed]))
    expect(created).toHaveLength(restored.installed.length)
  })

  it('migrates a legacy installed OAuth MCP to wait for authorization services', async () => {
    const patchPath = tempPatch()
    mkdirSync(dirname(patchPath), { recursive: true })
    writeFileSync(patchPath, JSON.stringify([{
      insert: [{
        id: 'legacy-notion',
        name: '@phoenix-ai/dsh-mcp-client',
        config: {
          transport: 'streamable-http',
          serverName: 'notion',
          url: 'https://mcp.notion.com/mcp',
          headers: {},
          oauth: true,
          toolCallTimeoutMs: 60_000,
          startupTimeoutMs: 5_000,
          failOnStartupError: false,
        },
        source: { kind: 'curated', connectorId: 'notion' },
      }],
    }]))

    const live = loader()
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: registry([]) })

    await expect(controller.installCuratedMcp('notion')).resolves.toMatchObject({
      status: 'already-installed',
      connector: { entryId: 'legacy-notion', serverName: 'notion' },
    })

    expect(live.update).toHaveBeenCalledWith('legacy-notion', {
      inject: [...MANAGED_MCP_INJECT],
    })
    expect(live.create).not.toHaveBeenCalled()

    const persisted = JSON.parse(readFileSync(patchPath, 'utf8')) as Array<{
      insert: Array<{ id: string; inject?: string[] }>
    }>
    expect(persisted[0]?.insert[0]).toMatchObject({
      id: 'legacy-notion',
      inject: [...MANAGED_MCP_INJECT],
    })
  })

  it('repairs a curated Supabase MCP from the Host-pinned endpoint', async () => {
    const patchPath = tempPatch()
    const live = loader()
    live.create
      .mockResolvedValueOnce('supabase-entry')
      .mockResolvedValueOnce('supabase-repaired')
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: registry([]) })

    const installed = await controller.installCuratedMcp('supabase')
    expect(installed.connector).toEqual({
      entryId: 'supabase-entry',
      serverName: 'supabase',
      url: 'https://mcp.supabase.com/mcp',
      source: { kind: 'curated', connectorId: 'supabase' },
    })
    await expect(controller.repair({ entryId: 'supabase-entry' })).resolves.toMatchObject({
      status: 'installed',
      connector: {
        entryId: 'supabase-repaired',
        serverName: 'supabase',
        url: 'https://mcp.supabase.com/mcp',
        source: { kind: 'curated', connectorId: 'supabase' },
      },
    })
  })

  it('installs and removes only the pinned official Binance Agent OS connector', async () => {
    const patchPath = tempPatch()
    const live = loader()
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: registry([]) })

    await expect(controller.installBinanceAgentOs()).resolves.toEqual({
      status: 'installed',
      connector: {
        entryId: 'live-entry-id',
        serverName: 'binance-agent-os',
        url: 'https://agent.binance.com/mcp/agentic',
      },
    })
    expect(live.create).toHaveBeenCalledWith({
      name: '@phoenix-ai/dsh-mcp-client',
      inject: [...MANAGED_MCP_INJECT],
      config: {
        transport: 'streamable-http',
        serverName: 'binance-agent-os',
        url: 'https://agent.binance.com/mcp/agentic',
        headers: {},
        oauth: true,
      },
    })
    await expect(controller.installBinanceAgentOs()).resolves.toMatchObject({
      status: 'already-installed',
      connector: { serverName: 'binance-agent-os' },
    })
    expect(live.create).toHaveBeenCalledTimes(1)

    await expect(controller.removeBinanceAgentOs()).resolves.toBe(true)
    expect(live.remove).toHaveBeenCalledWith('live-entry-id')
    await expect(controller.snapshot()).resolves.toEqual([])
    await expect(controller.removeBinanceAgentOs()).resolves.toBe(false)
  })

  it('installs and removes only the pinned official X API and Docs MCP pair', async () => {
    const patchPath = tempPatch()
    const live = loader()
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: registry([]) })

    await expect(controller.installXMcp()).resolves.toEqual({
      docs: {
        status: 'installed',
        connector: {
          entryId: 'live-entry-id',
          serverName: 'x-docs',
          url: 'https://docs.x.com/mcp',
        },
      },
      api: {
        status: 'installed',
        connector: {
          entryId: 'live-entry-id',
          serverName: 'x-api',
          url: 'https://api.x.com/mcp',
        },
      },
    })
    expect(live.create).toHaveBeenNthCalledWith(1, {
      name: '@phoenix-ai/dsh-mcp-client',
      inject: [...MANAGED_MCP_INJECT],
      config: {
        transport: 'streamable-http',
        serverName: 'x-docs',
        url: 'https://docs.x.com/mcp',
        headers: {},
        oauth: false,
      },
    })
    expect(live.create).toHaveBeenNthCalledWith(2, {
      name: '@phoenix-ai/dsh-mcp-client',
      inject: [...MANAGED_MCP_INJECT],
      config: {
        transport: 'stdio',
        serverName: 'x-api',
        command: 'npx',
        args: ['-y', '@xdevplatform/xurl', 'mcp', 'https://api.x.com/mcp'],
        env: {},
        envCredentialRefs: {
          CLIENT_ID: 'X_CLIENT_ID',
          CLIENT_SECRET: 'X_CLIENT_SECRET',
        },
        cwd: '',
        toolCallTimeoutMs: 60_000,
        startupTimeoutMs: 300_000,
        failOnStartupError: false,
        reconnect: {
          enabled: true,
          initialDelayMs: 1000,
          maxDelayMs: 30_000,
          maxAttempts: 10,
        },
      },
    })
    const persisted = readFileSync(patchPath, 'utf8')
    expect(persisted).toContain('X_CLIENT_ID')
    expect(persisted).toContain('X_CLIENT_SECRET')
    expect(persisted).not.toContain('client-secret-value')

    await expect(controller.installXMcp()).resolves.toMatchObject({
      api: { status: 'already-installed' },
      docs: { status: 'already-installed' },
    })
    expect(live.create).toHaveBeenCalledTimes(2)

    await expect(controller.installXMcp({
      identity: 'phoenix',
      username: '@PhoenixAI',
    })).resolves.toMatchObject({
      api: {
        status: 'installed',
        connector: {
          serverName: 'x-api-phoenix',
          url: 'https://api.x.com/mcp',
        },
      },
      docs: { status: 'already-installed' },
    })
    expect(live.create).toHaveBeenNthCalledWith(3, {
      name: '@phoenix-ai/dsh-mcp-client',
      inject: [...MANAGED_MCP_INJECT],
      config: {
        transport: 'stdio',
        serverName: 'x-api-phoenix',
        command: 'npx',
        args: ['-y', '@xdevplatform/xurl', 'mcp', '-u', 'PhoenixAI', 'https://api.x.com/mcp'],
        env: {},
        envCredentialRefs: {
          CLIENT_ID: 'X_CLIENT_ID',
          CLIENT_SECRET: 'X_CLIENT_SECRET',
        },
        cwd: '',
        toolCallTimeoutMs: 60_000,
        startupTimeoutMs: 300_000,
        failOnStartupError: false,
        reconnect: {
          enabled: true,
          initialDelayMs: 1000,
          maxDelayMs: 30_000,
          maxAttempts: 10,
        },
      },
    })
    await expect(controller.installXMcp({ identity: 'phoenix' }))
      .rejects.toThrow('requires its X username')
    await expect(controller.installXMcp({ identity: 'phoenix', username: 'bad-name!' }))
      .rejects.toThrow('1-15 characters')
    await expect(controller.installXMcp({ identity: 'phoenix', username: 'abcdefghijklmnop' }))
      .rejects.toThrow('1-15 characters')

    await expect(controller.removeXMcp()).resolves.toBe(true)
    expect(live.remove).toHaveBeenCalledTimes(3)
    await expect(controller.snapshot()).resolves.toEqual([])
    await expect(controller.removeXMcp()).resolves.toBe(false)
  })

  it('retires a legacy managed Jev row without touching other managed MCPs', async () => {
    const patchPath = tempPatch()
    mkdirSync(dirname(patchPath), { recursive: true })
    writeFileSync(patchPath, JSON.stringify([{
      insert: [
        {
          id: 'legacy-jev',
          name: '@phoenix-ai/dsh-mcp-client',
          inject: [...MANAGED_MCP_INJECT],
          config: {
            transport: 'streamable-http',
            serverName: 'jev',
            url: 'https://www.jevai.org/api/mcp',
            headers: {},
            oauth: false,
            bearerTokenRef: 'JEV_API_KEY',
            toolCallTimeoutMs: 1800,
            startupTimeoutMs: 1200,
            failOnStartupError: false,
            reconnect: {
              enabled: true,
              initialDelayMs: 1000,
              maxDelayMs: 30_000,
              maxAttempts: 3,
            },
          },
        },
        {
          id: 'calendar-managed',
          name: '@phoenix-ai/dsh-mcp-client',
          inject: [...MANAGED_MCP_INJECT],
          config: {
            transport: 'streamable-http',
            serverName: 'calendar-a1b2c3d',
            url: 'https://mcp.example.com/calendar',
            headers: {},
            oauth: true,
          },
        },
      ],
    }]))

    const live = loader()
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: registry([]) })

    await expect(controller.retireJev()).resolves.toBe(true)
    expect(live.remove).toHaveBeenCalledTimes(1)
    expect(live.remove).toHaveBeenCalledWith('legacy-jev')
    await expect(controller.snapshot()).resolves.toEqual([{
      entryId: 'calendar-managed',
      serverName: 'calendar-a1b2c3d',
      url: 'https://mcp.example.com/calendar',
    }])
    const persisted = readFileSync(patchPath, 'utf8')
    expect(persisted).not.toContain('JEV_API_KEY')
    expect(persisted).not.toContain('jevai.org')
    expect(persisted).toContain('calendar-managed')
    await expect(controller.retireJev()).resolves.toBe(false)
  })

  it('removes one exact managed connector from persistence and the live loader', async () => {
    const patchPath = tempPatch()
    const live = loader()
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: registry([candidate()]) })
    const installed = await controller.install({ name: 'io.example/calendar', version: '1.0.0' })

    await expect(controller.remove({ entryId: installed.connector.entryId })).resolves.toEqual({
      removed: true,
      liveUnloaded: true,
    })
    expect(live.remove).toHaveBeenCalledWith(installed.connector.entryId)
    await expect(controller.snapshot()).resolves.toEqual([])
    await expect(controller.remove({ entryId: installed.connector.entryId })).resolves.toEqual({
      removed: false,
      liveUnloaded: true,
    })
  })

  it('keeps generic uninstall persistence-first when live unload fails', async () => {
    const patchPath = tempPatch()
    const live = loader()
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: registry([candidate()]) })
    const installed = await controller.install({ name: 'io.example/calendar', version: '1.0.0' })
    live.remove.mockRejectedValueOnce(new Error('live unload failed'))

    await expect(controller.remove({ entryId: installed.connector.entryId })).resolves.toEqual({
      removed: true,
      liveUnloaded: false,
    })
    await expect(controller.snapshot()).resolves.toEqual([])
    expect(readFileSync(patchPath, 'utf8')).not.toContain(installed.connector.entryId)
  })

  it('repairs a registry-managed connector by re-resolving its exact registry source', async () => {
    const patchPath = tempPatch()
    let values: readonly McpRegistryCandidate[] = [candidate()]
    const search = vi.fn(async ({ query }: { query: string; limit?: number }): Promise<McpRegistrySearchSnapshot> => ({
      source: 'official-mcp-registry',
      query,
      fetchedAt: '2026-10-04T12:00:00.000Z',
      stale: false,
      candidates: [...values],
    }))
    const live = loader()
    live.create
      .mockResolvedValueOnce('old-entry')
      .mockResolvedValueOnce('repaired-entry')
    const controller = new ManagedMcpController(live, { patchPath, registrySearch: search })
    const installed = await controller.install({ name: 'io.example/calendar', version: '1.0.0' })

    values = [candidate({ remoteUrl: 'https://mcp.example.com/calendar-v2' })]
    const repaired = await controller.repair({ entryId: installed.connector.entryId })

    expect(live.remove).toHaveBeenCalledWith('old-entry')
    expect(repaired).toMatchObject({
      status: 'installed',
      connector: {
        entryId: 'repaired-entry',
        url: 'https://mcp.example.com/calendar-v2',
        source: { kind: 'registry', name: 'io.example/calendar', version: '1.0.0' },
      },
    })
    expect(search).toHaveBeenLastCalledWith({ query: 'io.example/calendar', limit: 20 })
  })

  it('does not invent a repair source for legacy managed rows', async () => {
    const patchPath = tempPatch()
    mkdirSync(dirname(patchPath), { recursive: true })
    writeFileSync(patchPath, JSON.stringify([{
      insert: [{
        id: 'legacy-calendar',
        name: '@phoenix-ai/dsh-mcp-client',
        config: {
          transport: 'streamable-http',
          serverName: 'calendar-legacy',
          url: 'https://mcp.example.com/calendar',
          headers: {},
          oauth: true,
        },
      }],
    }]))
    const controller = new ManagedMcpController(loader(), { patchPath, registrySearch: registry([candidate()]) })

    await expect(controller.repair({ entryId: 'legacy-calendar' }))
      .rejects.toThrow('has no trusted repair source')
    await expect(controller.snapshot()).resolves.toHaveLength(1)
  })

  it('refuses to configure or reinstall retired Jev', async () => {
    const patchPath = tempPatch()
    const live = loader()
    const jevCandidate = candidate({
      name: 'ai.jev/jev',
      title: 'Jev',
      remoteUrl: 'https://www.jevai.org/api/mcp',
    })
    const controller = new ManagedMcpController(live, {
      patchPath,
      registrySearch: registry([jevCandidate]),
    })

    await expect(controller.configureJev()).rejects.toThrow('Jev integration is retired')
    await expect(controller.install({ name: 'ai.jev/jev' })).rejects.toThrow('Jev integration is retired')
    expect(live.create).not.toHaveBeenCalled()
  })


  it('fails closed when registry identity, status, or transport is not installable', async () => {
    const patchPath = tempPatch()
    const live = loader()

    await expect(new ManagedMcpController(live, { patchPath, registrySearch: registry([]) })
      .install({ name: 'io.example/missing' }))
      .rejects.toThrow('changed or is no longer available')

    await expect(new ManagedMcpController(live, {
      patchPath,
      registrySearch: registry([candidate({ status: 'deprecated' })]),
    }).install({ name: 'io.example/calendar' }))
      .rejects.toThrow('is not active')

    const { remoteUrl: _remoteUrl, ...withoutRemote } = candidate()
    await expect(new ManagedMcpController(live, {
      patchPath,
      registrySearch: registry([withoutRemote]),
    }).install({ name: 'io.example/calendar' }))
      .rejects.toThrow('Streamable HTTP')

    await expect(new ManagedMcpController(live, {
      patchPath,
      registrySearch: registry([candidate()]),
    }).install({ name: 'io.example/calendar', version: '9.9.9' }))
      .rejects.toThrow('changed or is no longer available')

    await expect(new ManagedMcpController(live, {
      patchPath,
      registrySearch: registry([candidate()]),
    }).install({ name: ' ' }))
      .rejects.toThrow('valid server name')
    expect(live.create).not.toHaveBeenCalled()
  })

  it('uses a bounded readable server name even when the registry tail is unusable or very long', async () => {
    const firstPath = tempPatch()
    const first = new ManagedMcpController(loader(), {
      patchPath: firstPath,
      registrySearch: registry([candidate({
        name: '!!',
        remoteUrl: 'https://mcp.example.com/symbols',
      })]),
    })
    const symbolic = await first.install({ name: '!!' })
    expect(symbolic.connector.serverName).toMatch(/^mcp-[a-f0-9]{7}$/)

    const longName = 'io.example/this-is-an-extremely-long-connector-name-that-needs-truncation'
    const second = new ManagedMcpController(loader(), {
      patchPath: tempPatch(),
      registrySearch: registry([candidate({
        name: longName,
        remoteUrl: 'https://mcp.example.com/long',
      })]),
    })
    const long = await second.install({ name: longName })
    expect(long.connector.serverName.length).toBeLessThanOrEqual(32)
  })

  it('does not persist anything when live activation fails', async () => {
    const patchPath = tempPatch()
    const controller = new ManagedMcpController(loader({ createError: new Error('live failed') }), {
      patchPath,
      registrySearch: registry([candidate()]),
    })
    await expect(controller.install({ name: 'io.example/calendar' })).rejects.toThrow('live failed')
    await expect(controller.snapshot()).resolves.toEqual([])
  })

  it('rejects a corrupted managed overlay instead of executing altered configuration', async () => {
    const patchPath = tempPatch()
    mkdirSync(dirname(patchPath), { recursive: true })

    for (const value of [
      {},
      [],
      [{ nope: [] }],
      [{ insert: [null] }],
      [{ insert: [{ id: 'x', name: 'evil-package', config: {} }] }],
      [{ insert: [{ id: 'x', name: '@phoenix-ai/dsh-mcp-client', config: {
        transport: 'streamable-http', serverName: 'x', url: 'http://unsafe.example.com', headers: {}, oauth: true,
      } }] }],
      [{ insert: [{ id: 'x-api', name: '@phoenix-ai/dsh-mcp-client', config: {
        transport: 'stdio',
        serverName: 'x-api',
        command: 'npx',
        args: ['-y', '@xdevplatform/xurl', 'mcp', 'https://evil.example.com/mcp'],
        env: {},
        envCredentialRefs: { CLIENT_ID: 'X_CLIENT_ID', CLIENT_SECRET: 'X_CLIENT_SECRET' },
        cwd: '',
        toolCallTimeoutMs: 60_000,
        startupTimeoutMs: 300_000,
        failOnStartupError: false,
        reconnect: { enabled: true, initialDelayMs: 1000, maxDelayMs: 30_000, maxAttempts: 10 },
      } }] }],
    ]) {
      writeFileSync(patchPath, JSON.stringify(value))
      const controller = new ManagedMcpController(loader(), { patchPath, registrySearch: registry([candidate()]) })
      await expect(controller.snapshot()).rejects.toThrow(/managed MCP patch/)
    }
  })

  it('exports the generated default overlay path under the PHOENIX MCP directory', () => {
    expect(managedMcpPatchPath()).toMatch(/[\\/]mcp[\\/]managed\.patch\.yml$/)
  })
})
