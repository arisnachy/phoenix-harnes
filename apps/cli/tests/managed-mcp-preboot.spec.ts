import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { repairManagedMcpDependenciesBeforeBoot } from '../src/managed-mcp-preboot.ts'

const folders: string[] = []
const inject = ['tools', 'credentials', 'authorization', 'mcpConnectors']
function patch(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-preboot-'))
  folders.push(root)
  const file = join(root, 'managed.patch.yml')
  writeFileSync(file, JSON.stringify(value))
  return file
}
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

describe('managed MCP preboot migration', () => {
  it('restores OAuth dependencies before loading old Notion and Supabase while preserving identities and config', async () => {
    const entries = ['notion', 'supabase', 'canva', 'heygen'].map(serverName => ({
      name: '@phoenix-ai/dsh-mcp-client',
      id: 'id-' + serverName,
      config: { transport: 'streamable-http', serverName,
        url: 'https://example.test/' + serverName,
        oauth: true, headers: { Authorization: 'REDACTED-LOCAL-TEST' } },
      source: { kind: 'curated', connectorId: serverName },
    }))
    const hashed = {
      name: '@phoenix-ai/dsh-mcp-client',
      id: 'id-mcp-0d6fb89',
      config: { transport: 'streamable-http', serverName: 'mcp-0d6fb89', oauth: true },
      inject: [...inject],
      source: { kind: 'registry', name: 'ai.1325/mcp' },
    }
    const file = patch([{ insert: [...entries, hashed] }])
    expect(await repairManagedMcpDependenciesBeforeBoot(file)).toBe(4)
    const rows = (JSON.parse(readFileSync(file, 'utf8')) as Array<{ insert: typeof entries }>)[0]!.insert
    expect(rows).toHaveLength(5)
    rows.forEach(row => { expect((row as typeof hashed).inject).toEqual(inject) })
    expect(rows[0]!.config.headers).toEqual({ Authorization: 'REDACTED-LOCAL-TEST' })
    expect(rows[0]!.source).toEqual({ kind: 'curated', connectorId: 'notion' })
    const first = readFileSync(file, 'utf8')
    expect(await repairManagedMcpDependenciesBeforeBoot(file)).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(first)
  })

  it('also upgrades old managed stdio connectors before loader startup', async () => {
    const file = patch([{ insert: [{ name: '@phoenix-ai/dsh-mcp-client',
      id: 'filesystem', config: { transport: 'stdio', serverName: 'filesystem' } }] }])
    expect(await repairManagedMcpDependenciesBeforeBoot(file)).toBe(1)
    expect(JSON.parse(readFileSync(file, 'utf8'))[0].insert[0].inject).toEqual(inject)
  })

  it('never changes a malformed managed patch', async () => {
    const file = patch({ insert: [{ name: '@phoenix-ai/dsh-mcp-client' }] })
    const old = readFileSync(file, 'utf8')
    await expect(repairManagedMcpDependenciesBeforeBoot(file)).rejects.toThrow(/invalid/)
    expect(readFileSync(file, 'utf8')).toBe(old)
  })
})
