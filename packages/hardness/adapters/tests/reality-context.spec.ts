import { describe, expect, it } from 'vitest'
import {
  RealityContextEngine,
  realityConfigFromEnvironment,
} from '../src/reality-context.ts'

describe('Phoenix reality context', () => {
  it('does not accept partial or invalid coordinates as precise location', () => {
    expect(realityConfigFromEnvironment({
      PHOENIX_REALITY_LATITUDE: '19.45',
    })).not.toHaveProperty('latitude')

    expect(realityConfigFromEnvironment({
      PHOENIX_REALITY_LATITUDE: '999',
      PHOENIX_REALITY_LONGITUDE: '-70.7',
    })).not.toHaveProperty('latitude')
  })

  it('projects wall clock, UTC, timezone, monotonic time, device, runtime, and explicit unknowns', () => {
    const engine = new RealityContextEngine({ refreshMs: 30_000 })
    const fakeContext = {
      get(name: string) {
        return name === 'tools' || name === 'authorization' ? {} : undefined
      },
    } as never
    const snapshot = engine.snapshot(fakeContext, new Date('2026-09-20T13:58:00.000Z'))

    expect(snapshot.schema).toBe(1)
    expect(snapshot.time).toHaveProperty('wallClockUtc', '2026-09-20T13:58:00.000Z')
    expect(snapshot.time).toHaveProperty('monotonicMilliseconds')
    expect(snapshot.time).toHaveProperty('timezone')
    expect(snapshot.location).toMatchObject({ status: 'unknown' })
    expect(snapshot.weather).toMatchObject({ status: 'unknown' })
    expect(snapshot.capabilities).toMatchObject({
      activeServices: ['tools', 'authorization'],
    })
    expect(snapshot.authentication).toMatchObject({
      status: 'unknown',
      authorizationServiceAvailable: true,
    })
    expect(snapshot.device).toMatchObject({
      battery: expect.objectContaining({ value: null, source: 'not-probed' }),
      gpu: expect.objectContaining({ value: null, source: 'not-probed' }),
      powerState: {
        suspended: false,
        state: 'awake',
        source: 'current-process-execution',
        observedAt: '2026-09-20T13:58:00.000Z',
        precision: 'current sample only; Phoenix cannot execute a probe while the operating system is suspended',
      },
      screenLocked: expect.objectContaining({
        value: null,
        source: 'wtsapi32:WTSSessionInfoEx-unavailable',
      }),
    })
    expect(snapshot.network).toMatchObject({
      internetReachable: expect.objectContaining({ value: null, source: 'not-probed' }),
      latencyMs: expect.objectContaining({
        value: null,
        source: 'not-probed',
        precision: 'HTTPS HEAD round trip to example.com after DNS resolution; not ICMP ping',
      }),
      bandwidthMbps: {
        value: null,
        source: 'not-measured-to-avoid-bulk-background-traffic',
        stale: true,
      },
    })
    expect(snapshot.userState).toMatchObject({
      status: 'unknown',
      idleSeconds: null,
      awayThresholdSeconds: 300,
      source: 'not-probed',
      doNotDisturb: {
        value: null,
        source: 'not-authoritatively-probed',
        stale: true,
      },
    })
  })

  it('derives active versus away only from measured idle time and the explicit threshold', () => {
    const engine = new RealityContextEngine({ refreshMs: 30_000 })
    const internal = engine as unknown as {
      userActivity: {
        value: { idleSeconds: number; screenLocked: boolean | null } | null
        source: string
        observedAt: number
        expiresAt: number
        confidence: number
      }
    }
    const now = Date.parse('2026-09-20T15:00:00.000Z')
    internal.userActivity = {
      value: { idleSeconds: 299.9, screenLocked: false },
      source: 'test:last-input',
      observedAt: now - 1_000,
      expiresAt: now + 30_000,
      confidence: 0.98,
    }
    const active = engine.snapshot({ get() { return undefined } } as never, new Date(now))
    expect(active.userState).toMatchObject({
      status: 'active',
      idleSeconds: 299.9,
      awayThresholdSeconds: 300,
      source: 'test:last-input',
      stale: false,
      screenLocked: expect.objectContaining({
        value: false,
        source: 'wtsapi32:WTSSessionInfoEx',
        stale: false,
      }),
    })

    internal.userActivity = {
      value: { idleSeconds: 300, screenLocked: true },
      source: 'test:last-input',
      observedAt: now - 1_000,
      expiresAt: now + 30_000,
      confidence: 0.98,
    }
    const away = engine.snapshot({ get() { return undefined } } as never, new Date(now))
    expect(away.userState).toMatchObject({
      status: 'away',
      idleSeconds: 300,
      awayThresholdSeconds: 300,
      source: 'test:last-input',
      stale: false,
      screenLocked: expect.objectContaining({
        value: true,
        source: 'wtsapi32:WTSSessionInfoEx',
        stale: false,
      }),
    })
    expect(away.device).toMatchObject({
      powerState: {
        suspended: false,
        state: 'awake',
        source: 'current-process-execution',
        observedAt: '2026-09-20T15:00:00.000Z',
        precision: 'current sample only; Phoenix cannot execute a probe while the operating system is suspended',
      },
      screenLocked: expect.objectContaining({
        value: true,
        source: 'wtsapi32:WTSSessionInfoEx',
        stale: false,
      }),
    })
  })

  it('projects sanitized authorization, MCP, active-model, and provider quota telemetry', async () => {
    const engine = new RealityContextEngine({ refreshMs: 30_000 })
    const fakeContext = {
      get(name: string) {
        if (name === 'authorization') {
          return {
            list: () => [{
              key: 'openai',
              label: 'OpenAI',
              inFlight: false,
              methods: [{ id: 'oauth', label: 'OAuth' }],
            }],
            inspect: async () => ({
              kind: 'account',
              provider: 'openai',
              accountType: 'chatgpt',
              plan: 'plus',
              primaryLimit: { usedPercent: 42, windowDurationMins: 300 },
              credits: { hasCredits: true, unlimited: false, balance: '12.34' },
              usage: { lifetimeTokens: 12345 },
              connectors: [{
                id: 'calendar',
                name: 'Calendar',
                category: 'productivity',
                accessible: true,
                enabled: true,
                installed: true,
                callable: true,
              }],
            }),
          }
        }
        if (name === 'mcpConnectors') {
          return {
            list: () => [{
              serverName: 'workspace',
              status: 'ready',
              transport: 'stdio',
              toolNames: ['calendar_events_list', 'mail_search'],
            }],
          }
        }
        if (name === 'llm') {
          return {
            listProviders: () => [{ id: 'openai', name: 'OpenAI' }],
            listConfigurableProviders: () => [{
              provider: 'openai',
              displayName: 'OpenAI',
              settingsNs: 'llm-openai',
            }],
            resolveModelInfo: async () => ({
              provider: 'openai',
              id: 'gpt-test',
              name: 'GPT Test',
              context: { contextWindow: 128000 },
            }),
          }
        }
        if (name === 'agentDefaultModel') {
          return {
            currentSelection: () => ({
              provider: 'openai',
              model: 'gpt-test',
              reasoningEffort: 'high',
            }),
          }
        }
        if (name === 'tokenMeter') {
          return {
            measure: () => ({
              logRevision: 17,
              baseline: { kind: 'usage', tokens: 30_000 },
              surfaceDeltaTokens: 2_000,
              totalTokens: 32_000,
              surfaceTokens: 8_000,
              nodes: [],
            }),
          }
        }
        if (name === 'pluginInventory') {
          return {
            list: () => ({
              entries: [
                { entryId: 'tools', moduleName: '@phoenix-ai/dsh-tools', enabled: true, fiberPhase: 'active' },
                { entryId: 'broken', moduleName: '@phoenix-ai/broken', enabled: true, fiberPhase: 'failed' },
              ],
            }),
            updateState: () => ({
              status: 'ready',
              current: 'abc123',
              target: 'def456',
            }),
            localModelState: async () => ({
              mode: 'on-demand',
              selectedModelId: 'phoenix-mini',
              installedModelIds: ['phoenix-mini'],
              phase: 'ready',
              catalog: [],
            }),
          }
        }
        return undefined
      },
    } as never

    await engine.refreshRuntimeServices(fakeContext)
    const activeSession = { id: 'session-1' }
    const snapshot = engine.snapshot(fakeContext, new Date('2026-09-20T15:00:00.000Z'), {
      agent: {
        options: {
          provider: 'openai',
          model: 'gpt-test',
          reasoningEffort: 'high',
          maxTokens: 4_096,
        },
        session: activeSession,
      },
    })

    expect(snapshot.authentication).toMatchObject({
      status: 'available',
      accounts: [{
        key: 'openai',
        credentialState: 'valid',
        expiryState: 'unreported',
        provider: 'openai',
        plan: 'plus',
      }],
      mcp: [{
        serverName: 'workspace',
        status: 'ready',
      }],
    })
    expect(snapshot.ai).toMatchObject({
      status: 'available',
      activeModel: {
        provider: 'openai',
        model: 'gpt-test',
        reasoningEffort: 'high',
      },
      defaultModel: {
        provider: 'openai',
        model: 'gpt-test',
        reasoningEffort: 'high',
      },
      selectionSource: 'active-agent',
      contextWindowTokens: 128000,
      currentContextTokens: 32000,
      remainingContextTokens: 96000,
      outputReservationTokens: 4096,
      inputHeadroomAfterOutputReserveTokens: 91904,
      tokenMeasurement: {
        source: 'tokenMeter.measure(active-session)',
        logRevision: 17,
        baselineKind: 'usage',
        surfaceTokens: 8000,
      },
      tokenMeterAvailable: true,
      registeredProviders: [{ id: 'openai', name: 'OpenAI', health: 'registered-not-probed' }],
      accountLimits: [{
        key: 'openai',
        provider: 'openai',
        primaryLimit: { usedPercent: 42, windowDurationMins: 300 },
      }],
    })
    expect(snapshot.calendar).toMatchObject({
      status: 'connector-state-known',
      connectorCandidates: expect.arrayContaining([
        expect.objectContaining({ source: 'authorization', id: 'calendar' }),
        expect.objectContaining({ source: 'mcp', serverName: 'workspace' }),
      ]),
      events: null,
      availability: null,
    })
    expect(snapshot.phoenix).toMatchObject({
      pluginSummary: {
        total: 2,
        enabled: 2,
        active: 1,
        failed: 1,
      },
      update: {
        status: 'ready',
        current: 'abc123',
        target: 'def456',
      },
      degradedPlugins: [{
        entryId: 'broken',
        moduleName: '@phoenix-ai/broken',
        enabled: true,
        fiberPhase: 'failed',
      }],
      localModel: {
        mode: 'on-demand',
        selectedModelId: 'phoenix-mini',
        phase: 'ready',
      },
    })
  })

  it('uses non-expired browser geolocation without inventing civic labels', () => {
    const now = Date.parse('2026-09-20T15:00:00.000Z')
    const engine = new RealityContextEngine({ refreshMs: 30_000 })
    const fakeContext = {
      get(name: string) {
        if (name !== 'clientReality') return undefined
        return {
          locationFor: (id: string) => id === 'session-geo'
            ? {
                latitude: 19.451,
                longitude: -70.697,
                accuracyMeters: 24,
                observedAt: now - 2_000,
                receivedAt: now - 1_500,
                expiresAt: now + 120_000,
                source: 'browser-geolocation',
              }
            : undefined,
        }
      },
    } as never
    const snapshot = engine.snapshot(fakeContext, new Date(now), {
      agent: {
        id: 'session-geo',
        options: {},
        session: {},
      },
    })

    expect(snapshot.location).toMatchObject({
      status: 'authorized-browser',
      country: null,
      region: null,
      city: null,
      latitude: 19.451,
      longitude: -70.697,
      accuracyMeters: 24,
      source: 'browser-geolocation',
      retention: 'ephemeral-host-cache',
    })
  })

  it('marks configured coordinates as explicitly authorized/configured without inferring accuracy', () => {
    const engine = new RealityContextEngine({
      refreshMs: 30_000,
      latitude: 19.45,
      longitude: -70.70,
      locationLabel: 'configured test location',
    })
    const snapshot = engine.snapshot({ get() { return undefined } } as never)
    expect(snapshot.location).toMatchObject({
      status: 'authorized-configured',
      latitude: 19.45,
      longitude: -70.70,
      accuracyMeters: null,
      source: 'explicit PHOENIX_REALITY_* configuration',
    })
  })

  it('renders a model-facing reality envelope that forbids treating unknowns as facts', () => {
    const engine = new RealityContextEngine({ refreshMs: 30_000 })
    const rendered = engine.render({ get() { return undefined } } as never)
    expect(rendered).toContain('<phoenix_reality_context>')
    expect(rendered).toContain('Treat stale/unknown fields as unavailable')
  })
})
