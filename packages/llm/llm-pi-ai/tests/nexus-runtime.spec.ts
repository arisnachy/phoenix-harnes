import { describe, expect, it } from 'vitest'
import {
  NEXUS_MODEL, NEXUS_PROVIDER, NexusSelectorAdapter,
  nexusCodexFallback, nexusCodexHasReserve, nexusRequiresStrongModel,
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
  it('protects Codex 5h/7d reserves and requires capability for difficult tasks', () => {
    expect(nexusCodexHasReserve({ primaryUsedPercent: 97, secondaryUsedPercent: 22 })).toBe(false)
    expect(nexusCodexHasReserve({ primaryUsedPercent: 20, secondaryUsedPercent: 92 })).toBe(false)
    expect(nexusCodexHasReserve({ primaryUsedPercent: 40, secondaryUsedPercent: 75 })).toBe(true)
    expect(nexusRequiresStrongModel('Hola')).toBe(false)
    expect(nexusRequiresStrongModel('Implementar una aplicación clínica')).toBe(true)
  })
})
