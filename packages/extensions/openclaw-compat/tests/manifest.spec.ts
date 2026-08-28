import { describe, expect, it } from 'vitest'
import { translateOpenClawManifest, validateOpenClawExtension } from '../src/index.ts'

describe('OpenClaw manifest compatibility', () => {
  it('translates public extension contracts without executing runtime code', () => {
    const descriptor = translateOpenClawManifest({
      id: 'workboard',
      name: 'Workboard',
      description: 'Agent-owned work queue',
      activation: { onStartup: true, onCommands: ['workboard'] },
      configSchema: { type: 'object', additionalProperties: false, properties: {} },
      uiHints: { 'api.token': { label: 'Token', sensitive: true } },
      contracts: { tools: ['workboard_list', 'workboard_dispatch'] },
      channels: ['workboard-events'],
      secretProviderIntegrations: {
        vault: { providerAlias: 'vault', displayName: 'HashiCorp Vault' },
      },
      dashboard: {
        dataBindings: [{ id: 'cards.list', method: 'workboard.cards.list' }],
        actionVerbs: [{ id: 'dispatch', method: 'workboard.cards.dispatch' }],
      },
      skills: ['./skills'],
      futureContract: { enabled: true },
    })

    expect(descriptor.id).toBe('workboard')
    expect(descriptor.activation.onStartup).toBe(true)
    expect(descriptor.tools).toEqual(['workboard_list', 'workboard_dispatch'])
    expect(descriptor.channels).toEqual(['workboard-events'])
    expect(descriptor.requiredSecrets).toEqual(['api.token'])
    expect(descriptor.secretProviders).toEqual(['vault'])
    expect(descriptor.dashboard?.dataBindings[0]?.method).toBe('workboard.cards.list')
    expect(descriptor.skills).toEqual(['./skills'])
    expect(descriptor.openclawMetadata.futureContract).toEqual({ enabled: true })
  })

  it('redacts secret-looking values preserved in namespaced metadata', () => {
    const descriptor = translateOpenClawManifest({
      id: 'secret-fixture',
      name: 'Secret fixture',
      vendorMetadata: {
        token: 'do-not-leak',
        nested: { apiKey: 'also-secret', safe: 'visible' },
      },
    })

    expect(JSON.stringify(descriptor)).not.toContain('do-not-leak')
    expect(JSON.stringify(descriptor)).not.toContain('also-secret')
    expect(descriptor.openclawMetadata.vendorMetadata).toEqual({
      token: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', safe: 'visible' },
    })
  })

  it('reports missing secrets and unsupported platforms without throwing', () => {
    const descriptor = translateOpenClawManifest({
      id: 'linux-node',
      name: 'Linux Node',
      platforms: ['linux'],
      uiHints: { 'camera.secret': { sensitive: true } },
    })

    expect(validateOpenClawExtension(descriptor, { platform: 'darwin', availableSecrets: [] })).toEqual({
      status: 'UNSUPPORTED_PLATFORM',
      reasons: ['requires platform linux; current platform is darwin'],
    })

    expect(validateOpenClawExtension(descriptor, { platform: 'linux', availableSecrets: [] })).toEqual({
      status: 'MISSING_SECRET',
      reasons: ['missing secret reference camera.secret'],
    })

    expect(
      validateOpenClawExtension(descriptor, {
        platform: 'linux',
        availableSecrets: ['camera.secret'],
      }),
    ).toEqual({ status: 'READY', reasons: [] })
  })

  it('rejects malformed manifests with actionable errors', () => {
    expect(() => translateOpenClawManifest({ name: 'missing id' })).toThrow(/id/i)
    expect(() => translateOpenClawManifest({ id: 'Bad Id', name: 'bad' })).toThrow(/id/i)
  })
})
