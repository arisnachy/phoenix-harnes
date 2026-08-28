import { describe, expect, it, vi } from 'vitest'
import {
  createOpenClawCompatibilityRuntime,
  listOpenClawExtensions,
  toPhoenixCapabilities,
} from '../src/index.ts'

const entry = (id: string) => {
  const found = listOpenClawExtensions().find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`missing catalog fixture ${id}`)
  return found
}

describe('OpenClaw capability publication', () => {
  it('maps representative extension families into Phoenix capability kinds', () => {
    const expected = new Map([
      ['a2a', 'agent-protocol'],
      ['active-memory', 'memory'],
      ['device-pair', 'device'],
      ['browser', 'computer-use'],
      ['vault', 'secrets'],
      ['workboard', 'work'],
      ['webhooks', 'integration'],
      ['tavily', 'web-search'],
      ['document-extract', 'document'],
      ['elevenlabs', 'voice'],
      ['runway', 'media'],
      ['diagnostics-otel', 'observability'],
      ['codex', 'coding'],
      ['telegram', 'channel'],
      ['openai', 'model-provider'],
      ['ollama', 'local-inference'],
    ])

    for (const [id, kind] of expected) {
      expect(toPhoenixCapabilities(entry(id))).toEqual([
        { id: `openclaw:${id}`, extensionId: id, kind, source: 'openclaw' },
      ])
    }
  })

  it('publishes a fallback extension capability for every donor entry', () => {
    for (const donorEntry of listOpenClawExtensions()) {
      const capabilities = toPhoenixCapabilities(donorEntry)
      expect(capabilities).toHaveLength(1)
      expect(capabilities[0]?.extensionId).toBe(donorEntry.id)
      expect(capabilities[0]?.source).toBe('openclaw')
    }
  })
})

describe('OpenClaw compatibility runtime', () => {
  it('discovers the entire catalog without loading manifests or activating runtime code', () => {
    const loadManifest = vi.fn()
    const activateExtension = vi.fn()
    const runtime = createOpenClawCompatibilityRuntime({ loadManifest, activateExtension })

    const discovered = runtime.discover()

    expect(discovered).toHaveLength(153)
    expect(loadManifest).not.toHaveBeenCalled()
    expect(activateExtension).not.toHaveBeenCalled()
    expect(discovered.find(item => item.entry.id === 'a2a')?.capabilities[0]?.kind).toBe('agent-protocol')
  })

  it('gates activation on Phoenix platform and secret availability', async () => {
    const activateExtension = vi.fn()
    const runtime = createOpenClawCompatibilityRuntime({
      environment: { platform: 'linux', availableSecrets: [] },
      loadManifest: async donorEntry => donorEntry.id === 'linux-node'
        ? { id: 'linux-node', name: 'Linux Node', platforms: ['darwin'] }
        : { id: 'vault', name: 'Vault', uiHints: { 'vault.token': { sensitive: true } } },
      activateExtension,
    })

    expect(await runtime.activate('linux-node')).toEqual({
      id: 'linux-node',
      status: 'UNSUPPORTED_PLATFORM',
      reasons: ['requires platform darwin; current platform is linux'],
      active: false,
    })
    expect(await runtime.activate('vault')).toEqual({
      id: 'vault',
      status: 'MISSING_SECRET',
      reasons: ['missing secret reference vault.token'],
      active: false,
    })
    expect(activateExtension).not.toHaveBeenCalled()
  })

  it('activates and retracts through injected Phoenix-owned runtime hooks', async () => {
    const activateExtension = vi.fn(async () => undefined)
    const deactivateExtension = vi.fn(async () => undefined)
    const runtime = createOpenClawCompatibilityRuntime({
      environment: { platform: 'linux', availableSecrets: ['peer.token'] },
      loadManifest: async donorEntry => ({
        id: donorEntry.id,
        name: donorEntry.id,
        uiHints: donorEntry.id === 'a2a' ? { 'peer.token': { sensitive: true } } : {},
      }),
      activateExtension,
      deactivateExtension,
    })

    expect(await runtime.activate('a2a')).toEqual({ id: 'a2a', status: 'READY', reasons: [], active: true })
    expect(runtime.isActive('a2a')).toBe(true)
    expect(activateExtension).toHaveBeenCalledTimes(1)

    expect(await runtime.deactivate('a2a')).toBe(true)
    expect(runtime.isActive('a2a')).toBe(false)
    expect(deactivateExtension).toHaveBeenCalledTimes(1)
  })

  it('isolates malformed manifests and activation failures to the owning extension', async () => {
    const runtime = createOpenClawCompatibilityRuntime({
      loadManifest: async donorEntry => donorEntry.id === 'a2a'
        ? { name: 'missing id' }
        : { id: donorEntry.id, name: donorEntry.id },
      activateExtension: async descriptor => {
        if (descriptor.id === 'workboard') throw new Error('worker unavailable')
      },
    })

    expect(await runtime.status('a2a')).toEqual({
      id: 'a2a',
      status: 'INCOMPATIBLE_CONTRACT',
      reasons: expect.arrayContaining([expect.stringMatching(/id/i)]),
      active: false,
    })
    expect(await runtime.activate('workboard')).toEqual({
      id: 'workboard',
      status: 'ACTIVATION_FAILED',
      reasons: ['worker unavailable'],
      active: false,
    })

    expect((await runtime.status('openai')).status).toBe('READY')
  })
})
