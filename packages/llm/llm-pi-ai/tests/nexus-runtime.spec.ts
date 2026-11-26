import { describe, expect, it, vi } from 'vitest'
import {
  NEXUS_MODEL, NEXUS_PROVIDER, ORION_MODEL, ORION_PROVIDER, NexusSelectorAdapter,
  nexusCodexFallback, nexusCodexHasReserve, nexusCodexWithinPace, nexusRequiresStrongModel,
  nexusTurnText, nexusTurnHasHumanImage,
  nexusReadNativeCodexQuota, nexusCodexFreshReserve, nexusEconomyEffort, nexusAdaptiveEffort,
  nexusExactResponseTarget, nexusExactResponseQuality, installNexusRuntime,
  nexusNumericResponseTarget, nexusNumericResponseQuality, nexusOperatorPolicy, nexusQuotaView, nexusRequiredContext,
} from '../src/nexus-runtime.ts'

describe('ORIÓN synthetic model route', () => {
  it('advertises ORIÓN under PHOENIX independently from Eclipse and rejects raw synthetic calls', async () => {
    const adapter = new NexusSelectorAdapter()
    expect(ORION_PROVIDER).toBe(NEXUS_PROVIDER)
    expect(ORION_MODEL).toBe(NEXUS_MODEL)
    expect(adapter.providerInfo(NEXUS_PROVIDER).name).toBe('PHOENIX')
    expect(await adapter.listModels(NEXUS_PROVIDER)).toMatchObject([
      { provider: NEXUS_PROVIDER, id: NEXUS_MODEL, name: 'ORIÓN' },
    ])
    expect(() => adapter.stream({} as never)).toThrow('ORIÓN debe resolver')
  })
  it('selects from actual latest account catalog without creating an unlisted model', () => {
    expect(nexusCodexFallback(['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.2-sol'], true)).toBe('gpt-6.2-sol')
    expect(nexusCodexFallback(['gpt-6-luna', 'gpt-6.2-sol'], false)).toBe('gpt-6-luna')
    expect(nexusCodexFallback(['unrelated-model'], true)).toBeUndefined()
    expect(nexusCodexFallback(['gpt-6.2-sol'], false)).toBe('gpt-6.2-sol')
    expect(nexusCodexFallback(['gpt-6-luna'], true)).toBe('gpt-6-luna')
  })
  it('paces both windows using native reset timestamps rather than token guesses', () => {
    const now = 1_800_000_000_000
    const hour = 3_600_000
    const quota = {
      primaryUsedPercent: 20, secondaryUsedPercent: 20,
      resetPrimaryAt: now + 2 * hour, resetSecondaryAt: (now + 3 * 24 * hour) / 1_000,
    }
    expect(nexusCodexWithinPace(quota, now)).toBe(true)
    expect(nexusCodexWithinPace({ ...quota, resetSecondaryAt: now + 7 * 24 * hour }, now)).toBe(false)
    expect(nexusCodexWithinPace({ ...quota, resetPrimaryAt: now - 1 }, now)).toBe(false)
    expect(nexusCodexWithinPace({ primaryUsedPercent: 2, secondaryUsedPercent: 2 }, now)).toBe(false)
    expect(nexusCodexWithinPace(undefined, now)).toBe(false)
    expect(nexusCodexWithinPace({ ...quota, primaryUsedPercent: 98 }, now)).toBe(false)
  })
  it('protects Codex 5h/7d reserves and requires capability for difficult tasks', () => {
    expect(nexusCodexHasReserve(undefined)).toBe(false)
    expect(nexusCodexHasReserve({ primaryUsedPercent: 20 })).toBe(false)
    expect(nexusCodexHasReserve({ primaryUsedPercent: -1, secondaryUsedPercent: 20 })).toBe(false)
    expect(nexusCodexHasReserve({ primaryUsedPercent: 97, secondaryUsedPercent: 22 })).toBe(false)
    expect(nexusCodexHasReserve({ primaryUsedPercent: 20, secondaryUsedPercent: 92 })).toBe(false)
    expect(nexusCodexHasReserve({ primaryUsedPercent: 40, secondaryUsedPercent: 75 })).toBe(true)
    expect(nexusRequiresStrongModel('Hola')).toBe(false)
    expect(nexusRequiresStrongModel('Implementar una aplicación clínica')).toBe(true)
  })
})

describe('Nexus durable user evidence', () => {
  const events = [
    { type: 'turn/start', data: { turn: 12 } },
    { type: 'user/message', data: { source: { kind: 'user' },
      content: [{ type: 'text', text: '¿Qué tiempo hace hoy?' }] } },
    { type: 'user/message', data: { source: { kind: 'plugin' },
      content: [{ type: 'text', text: 'never treat this as user intent' },
        { type: 'image' }] } },
    { type: 'turn/start', data: { turn: 13 } },
    { type: 'user/message', data: { source: { kind: 'user' },
      content: [{ type: 'image' }, { type: 'text', text: 'Analiza esta imagen' }] } },
  ]
  it('reads actual session event data, not a nonexistent turn-wrapped message', () => {
    expect(nexusTurnText(events, 12)).toBe('¿Qué tiempo hace hoy?')
    expect(nexusTurnText(events, 13)).toBe('Analiza esta imagen')
    expect(nexusTurnHasHumanImage(events, 12)).toBe(false)
    expect(nexusTurnHasHumanImage(events, 13)).toBe(true)
    expect(nexusTurnText(events, 99)).toBe('')
    expect(nexusTurnHasHumanImage(events, 99)).toBe(false)
  })
})

describe('native Codex window freshness and economic reasoning',()=>{
  const now=1_800_000_000_000,hour=3_600_000
  const window = (minutes: number, used: number, hours: number) => ({
    windowDurationMins: minutes, usedPercent: used, resetsAt: (now + hours * hour) / 1000, observedAt: now - 1000,
  })
  const telemetry = { kind: 'account', provider: 'Codex', accountType: 'chatgpt',
    primaryLimit: window(10080, 30, 72), secondaryLimit: window(300, 20, 2) }
  it('maps actual window durations and rejects API-key, stale, expired and ambiguous samples',()=>{
    const quota=nexusReadNativeCodexQuota(telemetry)
    expect(quota?.primaryUsedPercent).toBe(20)
    expect(quota?.secondaryUsedPercent).toBe(30)
    expect(nexusCodexFreshReserve(quota,now)).toBe(true)
    expect(nexusCodexFreshReserve(quota,now+121000)).toBe(false)
    expect(nexusCodexFreshReserve({ ...quota, resetPrimaryAt: now / 1000 },now)).toBe(false)
    expect(nexusReadNativeCodexQuota({ ...telemetry, accountType: 'apiKey' })).toBeUndefined()
    expect(nexusReadNativeCodexQuota({ ...telemetry, secondaryLimit: telemetry.primaryLimit })).toBeUndefined()
  })
  it('never invents effort names or reduces complex task reasoning',()=>{
    expect(nexusEconomyEffort(['high','low','medium'],false)).toBe('low')
    expect(nexusEconomyEffort(['high','medium'],false)).toBeUndefined()
    expect(nexusEconomyEffort(['high','low'],true)).toBeUndefined()
    expect(nexusAdaptiveEffort(['high','medium','low'], true, 0.2)).toBe('high')
    expect(nexusAdaptiveEffort(['high','medium','low'], true, 0.8)).toBe('medium')
    expect(nexusAdaptiveEffort(['high','medium','low'], false, 0.8)).toBe('low')
    expect(nexusAdaptiveEffort(['custom'], true, 0.8)).toBeUndefined()
  })
})


describe('independent Nexus acceptance', () => {
  it('only grades explicit exact-response contracts and requires five measured outcomes', () => {
    expect(nexusExactResponseTarget('Responde exactamente: "OK"')).toBe('OK')
    expect(nexusExactResponseTarget('Reply exactly: "42"')).toBe('42')
    expect(nexusExactResponseTarget('Analiza estos datos')).toBeUndefined()
    expect(nexusExactResponseTarget('Reply exactly: "42" and explain')).toBeUndefined()
    expect(nexusExactResponseQuality([{ exactResponseAccepted: true }, {}])).toBeUndefined()
    expect(nexusExactResponseQuality(Array.from({ length: 5 }, () =>
      ({ exactResponseAccepted: true })))).toBeCloseTo(7 / 9)
    expect(nexusExactResponseQuality(Array.from({ length: 5 }, () =>
      ({ exactResponseAccepted: false })))).toBeCloseTo(2 / 9)
  })
})

describe('Nexus installed runtime failover', () => {
  it('prioritizes the quota-authorized Codex subscription and retries with verified free only on failure', async () => {
    const now = Date.now()
    const telemetry = { kind: 'account', provider: 'Codex', accountType: 'chatgpt',
      primaryLimit: { windowDurationMins: 300, usedPercent: 1,
        resetsAt: Math.floor((now + 3_600_000) / 1000), observedAt: now },
      secondaryLimit: { windowDurationMins: 10080, usedPercent: 1,
        resetsAt: Math.floor((now + 3 * 86_400_000) / 1000), observedAt: now },
    }
    const hooks = new Map<string, unknown>()
    const ctx = {
      on: (event: string, listener: unknown) => { hooks.set(event, listener) },
      get: () => ({
        list: () => [{ key: 'subagent-codex/account' }],
        inspect: async () => telemetry,
      }),
      llm: {
        registerAdapter: () => undefined,
        listProviders: () => [{ id: 'openrouter' }, { id: 'openai-codex' }],
        listModels: async (provider: string) => provider === 'openrouter'
          ? [{ id: 'fixture/free', name: 'Free' }]
          : [{ id: 'gpt-6-luna', name: 'Luna' }],
        resolveModelInfo: async () => ({ context: { contextWindow: 128000 }, reasoning: { efforts: [{ id: 'low' }] } }),
      },
    }
    const profiles = new Map([['openrouter', {}], ['openai-codex', {}]])
    const agent = { session: { id: 'nexus-fixture', events: [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' },
        content: [{ type: 'text', text: 'Hola' }] } },
    ] } }
    const payload = { agent, turn: 1, step: 1, signal: new AbortController().signal, approximateInputTokens: 4000 }
    const selected = { provider: NEXUS_PROVIDER, model: NEXUS_MODEL }
    type Route = { provider: string; model: string; reasoningEffort?: string }
    type Failure = typeof payload & { provider: string; failure: { code: string } }
    vi.stubGlobal('fetch', async () => ({
      ok: true, text: async () => JSON.stringify({ data: [{
        id: 'fixture/free', pricing: { prompt: '0', completion: '0', request: '0' },
        context_length: 32768, supported_parameters: ['tools'],
      }] }),
    }))
    try {
      const inspect = installNexusRuntime(ctx as never, {
        profiles: () => profiles as never,
        providerAuthorized: async () => true,
        nativeCodexAuthorized: async () => true,
      })
      const route = hooks.get('agent/request') as
        (p: typeof payload, next: () => Promise<Route>) => Promise<Route>
      const fail = hooks.get('agent/request-error') as
        (p: Failure, next: () => Promise<undefined>) => Promise<{ kind: string } | undefined>
      expect(await route(payload, async () => selected)).toMatchObject({
        provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'low',
      })
      const snapshot = await inspect(payload.signal, { sessionId: agent.session.id })
      expect(snapshot.lastDispatchedRoute).toBe('openai-codex/gpt-6-luna')
      expect(snapshot.lastDispatchedEffort).toBe('low')
      expect(snapshot.lastExecution).toBeNull()
      expect(snapshot.dispatchIdentityBasis).toBe('route-selected-not-execution-proof')
      type StreamRequest = Route & { sessionId: string }
      const stream = hooks.get('llm/stream') as (
        request: StreamRequest, next: () => AsyncIterable<unknown>,
      ) => AsyncIterable<unknown>
      const observed = stream({
        provider: 'openai-codex', model: 'gpt-6-luna', sessionId: agent.session.id,
      }, async function* () {
        yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 2 } }
      })
      for await (const chunk of observed) {
        expect(chunk).toMatchObject({ type: 'usage' })
      }
      const execution = await inspect(payload.signal, { sessionId: agent.session.id })
      expect(execution.lastExecution).toMatchObject({
        provider: 'openai-codex', model: 'gpt-6-luna', stage: 'stream-observed',
        reasoningEffort: 'low', reasoningBasis: 'request-config',
        usage: { inputTokens: 14, outputTokens: 3 },
      })
      expect(snapshot.quota.fiveHours).toMatchObject({ status: 'reported', remainingPercent: 99 })
      expect(snapshot.total).toBe(2)
      expect(snapshot.models.map(m => m.priceClass)).toContain('verified-free')
      expect(await fail({ ...payload, provider: 'openai-codex', failure: { code: 'TIMEOUT' } },
        async () => undefined)).toEqual({ kind: 'retry' })
      expect(await route(payload, async () => selected)).toMatchObject({
        provider: 'openrouter', model: 'fixture/free',
      })
      await expect(route({ ...payload, agent: { session: { ...agent.session, id: 'large-context' } }, approximateInputTokens: 50000 }, async () => selected)).rejects.toThrow('no verified free model')
      expect(await fail({ ...payload, provider: 'openrouter', failure: { code: 'RATE_LIMIT' } },
        async () => undefined)).toEqual({ kind: 'retry' })
      await expect(route(payload, async () => selected)).rejects.toMatchObject({ code: 'NEXUS_NO_ELIGIBLE_ROUTE' })
      expect(await fail({ ...payload, provider: 'openai-codex', failure: { code: 'TIMEOUT' } },
        async () => undefined)).toBeUndefined()
    } finally { vi.unstubAllGlobals() }
  })
})


describe('Nexus additional-provider attestation', () => {
  const now = 1_800_000_000_000
  const policy = { provider: 'nvidia', model: 'example/model',
    baseURL: 'https://example.com/v1', verifiedAt: now - 1000, expiresAt: now + 1000,
    allChargesZero: true, noOverage: true, supportsTools: true, contextWindow: 32768 }
  it('accepts only a fresh explicit matching endpoint/model with no overage', () => {
    expect(nexusOperatorPolicy([policy], 'nvidia', policy.model, policy.baseURL, now)).toEqual(policy)
    expect(nexusOperatorPolicy([policy], 'nvidia', policy.model, 'https://other.example/v1', now)).toBeUndefined()
    expect(nexusOperatorPolicy([policy], 'nvidia', policy.model, policy.baseURL, now + 1000)).toBeUndefined()
    expect(nexusOperatorPolicy([{ ...policy, noOverage: false }], 'nvidia', policy.model, policy.baseURL, now)).toBeUndefined()
    expect(nexusOperatorPolicy([policy, policy], 'nvidia', policy.model, policy.baseURL, now)).toBeUndefined()
    expect(nexusOperatorPolicy([{ ...policy, provider: 'phoenix-local' }], 'phoenix-local', policy.model, policy.baseURL, now)).toBeUndefined()
  })
})

describe('Nexus independent arithmetic acceptance', () => {
  it('solves small explicit arithmetic without executing model output', () => {
    expect(nexusNumericResponseTarget('Calcula 29 × 7. Responde solo con el número')).toBe('203')
    expect(nexusNumericResponseTarget('Calculate -7 - -3')).toBe('-4')
    expect(nexusNumericResponseTarget('Calculate 1 + 2 and deploy the result')).toBeUndefined()
    expect(nexusNumericResponseTarget('Calculate 1 / 0')).toBeUndefined()
    expect(nexusNumericResponseQuality([{ numericResponseAccepted: true }, {}])).toBeUndefined()
    expect(nexusNumericResponseQuality(Array.from({ length: 5 }, () => ({ numericResponseAccepted: true })))).toBeCloseTo(7 / 9)
  })
})


describe('Nexus native account snapshot', () => {
  it('shows exhausted or available percentages and reset times without fictional token balances', () => {
    const now = 1_800_000_000_000
    const view = nexusQuotaView({ primaryUsedPercent: 100, secondaryUsedPercent: 40,
      resetPrimaryAt: (now + 3_600_000) / 1000, resetSecondaryAt: now + 86_400_000,
      primaryObservedAt: now, secondaryObservedAt: now }, now)
    expect(view.fiveHours).toMatchObject({ status: 'reported', remainingPercent: 0, remainingMs: 3_600_000 })
    expect(view.sevenDays).toMatchObject({ status: 'reported', remainingPercent: 60, remainingMs: 86_400_000 })
    expect(view.sevenDays).toMatchObject({
      remainingDays: 1, remainingHours: 0, remainingMinutes: 0,
      suggestedPercentPerDay: 51, suggestedPercentPerHour: 2.125,
    })
    expect(view.exactTokenBalance).toBeNull()
    expect(nexusQuotaView(undefined, now).fiveHours).toEqual({ status: 'unknown' })
  })
})


describe('Nexus live context budget', () => {
  it('reserves output and estimation margin for actual request size', () => {
    expect(nexusRequiredContext(4000)).toBe(7048)
    expect(nexusRequiredContext(50000, 4096)).toBe(66596)
    expect(nexusRequiredContext(undefined)).toBeUndefined()
    expect(nexusRequiredContext(-1)).toBeUndefined()
    expect(nexusRequiredContext(1000, 0)).toBeUndefined()
  })
})
