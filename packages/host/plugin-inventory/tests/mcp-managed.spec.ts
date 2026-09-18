import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManagedMcpController,
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

function loader(options: { createError?: Error; removeError?: Error } = {}): ManagedMcpLoader & {
  create: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
} {
  return {
    create: vi.fn(async () => {
      if (options.createError !== undefined) throw options.createError
      return 'live-entry-id'
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
    await expect(controller.install({ name: ' io.example/calendar ', version: '1.0.0' })).resolves.toEqual({
      status: 'installed',
      connector: {
        entryId: 'live-entry-id',
        serverName: expect.stringMatching(/^calendar-[a-f0-9]{7}$/),
        url: 'https://mcp.example.com/calendar',
      },
    })
    expect(search).toHaveBeenCalledWith({ query: 'io.example/calendar', limit: 20 })
    expect(live.create).toHaveBeenCalledWith({
      name: '@phoenix-ai/dsh-mcp-client',
      config: {
        transport: 'streamable-http',
        serverName: expect.stringMatching(/^calendar-[a-f0-9]{7}$/),
        url: 'https://mcp.example.com/calendar',
        headers: {},
        oauth: true,
      },
    })
    const persisted = JSON.parse(readFileSync(patchPath, 'utf8')) as unknown[]
    expect(persisted).toHaveLength(1)
    await expect(controller.snapshot()).resolves.toEqual([{
      entryId: 'live-entry-id',
      serverName: expect.stringMatching(/^calendar-[a-f0-9]{7}$/),
      url: 'https://mcp.example.com/calendar',
    }])

    await expect(controller.install({ name: 'io.example/calendar' })).resolves.toMatchObject({
      status: 'already-installed',
      connector: { entryId: 'live-entry-id' },
    })
    expect(live.create).toHaveBeenCalledTimes(1)
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

    await expect(new ManagedMcpController(live, {
      patchPath,
      registrySearch: registry([candidate({ remoteUrl: undefined })]),
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
    const root = patchPath.slice(0, patchPath.lastIndexOf('/'))
    const { mkdirSync } = await import('node:fs')
    mkdirSync(root, { recursive: true })

    for (const value of [
      {},
      [],
      [{ nope: [] }],
      [{ insert: [null] }],
      [{ insert: [{ id: 'x', name: 'evil-package', config: {} }] }],
      [{ insert: [{ id: 'x', name: '@phoenix-ai/dsh-mcp-client', config: {
        transport: 'streamable-http', serverName: 'x', url: 'http://unsafe.example.com', headers: {}, oauth: true,
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
