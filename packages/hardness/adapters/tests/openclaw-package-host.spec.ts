import { describe, expect, it, vi } from 'vitest'
import {
  OPENCLAW_CORE_PACKAGE_SPEC,
  OpenClawPackageHost,
  registrationFamilyForOpenClawExtension,
  resolveOpenClawInstallCandidate,
} from '../src/openclaw/package-host.ts'
import { OPENCLAW_DONOR_COMMIT, listOpenClawExtensions } from '../src/openclaw/catalog.ts'

const signal = new AbortController().signal

describe('OpenClaw isolated package host', () => {
  it('resolves only pinned official install candidates with no mutable source URL', () => {
    const candidate = resolveOpenClawInstallCandidate('brave')

    expect(candidate).toEqual({
      extensionId: 'brave',
      coreSpec: 'openclaw@2026.8.1',
      pluginSelector: 'brave',
      donorCommit: OPENCLAW_DONOR_COMMIT,
      source: 'official-catalog',
      registrationFamily: 'web-search',
    })
    expect(OPENCLAW_CORE_PACKAGE_SPEC).toBe('openclaw@2026.8.1')
    expect(JSON.stringify(candidate)).not.toMatch(/https?:|git\+|\/main\b/i)
    expect(() => resolveOpenClawInstallCandidate('not-in-donor')).toThrow('unknown OpenClaw extension')
  })

  it('assigns every pinned extension to a closed registration family inventory', () => {
    const families = new Set(listOpenClawExtensions().map(entry => registrationFamilyForOpenClawExtension(entry.id)))

    expect(families).toEqual(new Set([
      'agent-protocol', 'memory', 'device', 'computer-use', 'secrets', 'work',
      'integration', 'web-search', 'document', 'voice', 'media', 'observability',
      'coding', 'channel', 'provider', 'extension',
    ]))
  })

  it('prepares lazily, executes only a prepared package, and retracts it cleanly', async () => {
    const execute = vi.fn(async () => ({
      isError: false as const,
      value: null,
      content: [{ type: 'text' as const, text: 'ok' }],
    }))
    const deactivate = vi.fn(async () => {})
    const prepare = vi.fn(async () => ({
      kind: 'ready' as const,
      package: { registrations: ['web-search' as const], execute, deactivate },
    }))
    const host = new OpenClawPackageHost({ prepare })

    expect(prepare).not.toHaveBeenCalled()
    await expect(host.execute('brave', {}, { callId: 'before-prepare' as never, signal }))
      .rejects.toThrow('not prepared')

    await expect(host.prepare('brave', signal)).resolves.toEqual({ kind: 'ready', extensionId: 'brave' })
    expect(prepare).toHaveBeenCalledWith(resolveOpenClawInstallCandidate('brave'), signal)
    await expect(host.execute('brave', { query: 'phoenix' }, { callId: 'call-1' as never, signal }))
      .resolves.toMatchObject({ isError: false })
    expect(execute).toHaveBeenCalledWith({ query: 'phoenix' }, expect.objectContaining({ signal }))

    await host.deactivate('brave')
    expect(deactivate).toHaveBeenCalledOnce()
    await expect(host.execute('brave', {}, { callId: 'after-deactivate' as never, signal }))
      .rejects.toThrow('not prepared')
  })

  it('fails closed when the prepared package does not register its declared family', async () => {
    const host = new OpenClawPackageHost({
      prepare: vi.fn(async () => ({
        kind: 'ready' as const,
        package: {
          registrations: ['provider' as const],
          execute: vi.fn(),
          deactivate: vi.fn(async () => {}),
        },
      })),
    })

    await expect(host.prepare('brave', signal)).resolves.toEqual({
      kind: 'blocked',
      status: 'INCOMPATIBLE_CONTRACT',
      reasons: ['extension brave did not register required family web-search'],
    })
  })

  it('preserves typed installer diagnostics without activating the extension', async () => {
    const prepare = vi.fn(async () => ({
      kind: 'blocked' as const,
      status: 'MISSING_SECRET' as const,
      reasons: ['missing credential reference BRAVE_API_KEY'],
    }))
    const host = new OpenClawPackageHost({ prepare })

    await expect(host.prepare('brave', signal)).resolves.toEqual({
      kind: 'blocked',
      status: 'MISSING_SECRET',
      reasons: ['missing credential reference BRAVE_API_KEY'],
    })
  })
})
