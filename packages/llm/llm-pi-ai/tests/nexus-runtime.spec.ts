import { describe, expect, it } from 'vitest'
import {
  NEXUS_MODEL, NEXUS_PROVIDER, NexusSelectorAdapter,
  nexusCodexFallback, nexusCodexHasReserve, nexusCodexWithinPace, nexusRequiresStrongModel,
  nexusTurnText, nexusTurnHasHumanImage,
} from '../src/nexus-runtime.ts'

describe('Nexus synthetic model route', () => {
  it('advertises Nexus independently from Eclipse and refuses raw synthetic calls', async () => {
    const adapter = new NexusSelectorAdapter()
    expect(adapter.providerInfo(NEXUS_PROVIDER).name).toBe('PHOENIX Nexus')
    expect(await adapter.listModels(NEXUS_PROVIDER)).toMatchObject([
      { provider: NEXUS_PROVIDER, id: NEXUS_MODEL },
    ])
    expect(() => adapter.stream({} as never)).toThrow('Nexus must resolve')
  })
  it('selects from actual latest account catalog without creating an unlisted model', () => {
    expect(nexusCodexFallback(['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.2-sol'], true)).toBe('gpt-6.2-sol')
    expect(nexusCodexFallback(['gpt-6-luna', 'gpt-6.2-sol'], false)).toBe('gpt-6-luna')
    expect(nexusCodexFallback(['unrelated-model'], true)).toBeUndefined()
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
