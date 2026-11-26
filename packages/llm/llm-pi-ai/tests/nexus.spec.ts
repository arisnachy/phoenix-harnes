import { describe, expect, it } from 'vitest'
import {
  NexusQuotaGovernor, chooseNexusRoute, nexusEstimatedQuality, nexusInventory,
  nexusPriceClass, updateNexusCalibration, openRouterPriceEvidence,
} from '../src/nexus.ts'
import type { NexusModel } from '../src/nexus.ts'

const NOW = 1_800_000_000_000
const free: NexusModel = {
  provider: 'openrouter', id: 'model-a', configured: true, authorized: true, online: true,
  supportsTools: true, contextWindow: 32_768, observedQuality: 0.85,
  observedLatencyMs: 500,
  price: { source: 'provider-api', observedAt: NOW - 1_000, expiresAt: NOW + 2_000,
    inputPerMillion: 0, outputPerMillion: 0, accountEligible: true, allChargesVerified: true },
}
const paid: NexusModel = {
  ...free, provider: 'openai-codex', id: 'gpt-x',
  price: { source: 'provider-api', observedAt: NOW - 1_000, inputPerMillion: 2, outputPerMillion: 12 },
}
describe('Nexus price classification', () => {
  it('does not infer free from a -free suffix or unverified catalog metadata', () => {
    expect(nexusPriceClass({ price: undefined }, NOW)).toBe('unknown')
    expect(nexusPriceClass({ price: { source: 'catalog-unverified', observedAt: NOW, inputPerMillion: 0, outputPerMillion: 0 } }, NOW)).toBe('unknown')
    expect(nexusPriceClass({ price: { ...free.price!, expiresAt: NOW } }, NOW)).toBe('unknown')
    expect(nexusPriceClass(free, NOW)).toBe('verified-free')
    expect(nexusPriceClass(paid, NOW)).toBe('paid')
  })
  it('distinguishes limited credits from price zero', () => {
    expect(nexusPriceClass({ price: { source: 'provider-api', observedAt: NOW,
      freeAllowance: true, accountEligible: true, allowanceRemaining: 3, allowanceUnit: 'requests' } }, NOW)).toBe('limited-free')
  })
})
describe('Nexus quota governance', () => {
  it('forecasts 5h and 7d windows without pretending to know account balance', () => {
    const meter = new NexusQuotaGovernor()
    meter.record({ provider: 'openai-codex', model: 'sol', timestamp: NOW - 3_600_000, inputTokens: 50, outputTokens: 50 })
    meter.record({ provider: 'openai-codex', model: 'luna', timestamp: NOW - 14_400_000, inputTokens: 25, outputTokens: 25 })
    const five = meter.forecast({ provider: 'openai-codex', name: '5h', windowMs: 18_000_000,
      anchorAt: NOW - 17_000_000, limit: 200, unit: 'tokens', source: 'user-configured' }, NOW)
    expect(five.observedSpent).toBe(150)
    expect(five.remaining).toBe(50)
    expect(five.exactBalance).toBe(false)
    const weekly = meter.forecast({ provider: 'openai-codex', name: '7d', windowMs: 604_800_000,
      anchorAt: NOW - 600_000_000, unit: 'tokens', source: 'estimated' }, NOW)
    expect(weekly.remaining).toBeUndefined()
    expect(weekly.observedSpent).toBe(150)
    expect(weekly.projectedDailyUsage).toBe(150)
  })
  it('rejects negative receipts', () => {
    const meter = new NexusQuotaGovernor()
    expect(() => {
      meter.record({ provider: 'x', model: 'x', timestamp: NOW, inputTokens: -1, outputTokens: 0 })
    }).toThrow()
  })
})
describe('Nexus route safety', () => {
  it('uses only authorized configured verified-free models by default', () => {
    expect(chooseNexusRoute([paid, free], { needsTools: true }, NOW)).toMatchObject({
      provider: 'openrouter', model: 'model-a', priceClass: 'verified-free',
    })
    expect(chooseNexusRoute([paid], {}, NOW)).toBeUndefined()
    const limited: NexusModel = { ...free, price: {
      source: 'provider-api', observedAt: NOW, freeAllowance: true,
      accountEligible: true, allowanceRemaining: 1, allowanceUnit: 'requests',
    } }
    expect(chooseNexusRoute([limited], {}, NOW)).toBeUndefined()
    expect(chooseNexusRoute([{ ...free, authorized: false }], {}, NOW)).toBeUndefined()
  })
  it('keeps local models disabled by default and validates context/tools', () => {
    expect(chooseNexusRoute([{ ...free, local: true }], {}, NOW)).toBeUndefined()
    expect(chooseNexusRoute([{ ...free, local: true }], { allowLocal: true }, NOW)?.model).toBe('model-a')
    expect(chooseNexusRoute([free], { inputTokens: 40_000 }, NOW)).toBeUndefined()
    expect(chooseNexusRoute([{ ...free, supportsTools: false }], { needsTools: true }, NOW)).toBeUndefined()
  })
  it('rejects unknown costs under free-only rules', () => {
    expect(chooseNexusRoute([{ ...free, price: undefined }], {}, NOW)).toBeUndefined()
    expect(chooseNexusRoute([paid], { allowPaid: true }, NOW)?.model).toBe('gpt-x')
  })
})
describe('Nexus calibration and inventory', () => {
  it('smooths observed validation outcomes and never assumes configured means authorized', () => {
    const receipt = updateNexusCalibration(undefined, true, 250, 120)
    expect(nexusEstimatedQuality(receipt)).toBe(0.6)
    const inventory = nexusInventory([{ id: 'openrouter', models: [{ id: 'x' }] },
      { id: 'phoenix-local', models: [{ id: 'ollama:y' }] }])
    expect(inventory).toHaveLength(2)
    expect(inventory[0]?.authorized).toBe(false)
    expect(inventory[1]?.local).toBe(true)
  })
})

describe('OpenRouter pricing', () => {
  it('normalizes per-token rates, extra request charges and expiry', () => {
    const listed = openRouterPriceEvidence({ data: [
      { id: 'genuine-free', pricing: { prompt: '0', completion: '0', request: '0' } },
      { id: 'request-paid', pricing: { prompt: '0', completion: '0', request: '0.1' } },
      { id: 'per-token-paid', pricing: { prompt: '0.000001', completion: '0.000002' } },
      { id: 'bad', pricing: { prompt: 'unknown', completion: '0' } },
      { id: 'blank', pricing: { prompt: ' ', completion: '0' } },
    ] }, NOW, 2_000)
    expect(listed.has('bad')).toBe(false)
    expect(listed.has('blank')).toBe(false)
    expect(nexusPriceClass({ price: listed.get('genuine-free') }, NOW)).toBe('verified-free')
    expect(nexusPriceClass({ price: listed.get('genuine-free') }, NOW + 2_000)).toBe('unknown')
    expect(nexusPriceClass({ price: listed.get('request-paid') }, NOW)).toBe('paid')
    expect(listed.get('per-token-paid')?.inputPerMillion).toBe(1)
  })
  it('refuses free classification when an extra charge cannot be interpreted', () => {
    const prices = openRouterPriceEvidence({ data: [{ id: 'ambiguous', pricing: {
      prompt: '0', completion: '0', image: 'unavailable',
    } }] }, NOW)
    expect(nexusPriceClass({ price: prices.get('ambiguous') }, NOW)).toBe('unknown')
  })
})


describe('Nexus strict pricing and context admission', () => {
  it('does not authorize stale, indefinite, malformed or newly introduced charges', () => {
    const { expiresAt: _expires, ...noExpiry } = free.price!
    expect(nexusPriceClass({ price: noExpiry }, NOW)).toBe('unknown')
    expect(nexusPriceClass({ price: { ...free.price!, observedAt: NaN } }, NOW)).toBe('unknown')
    const listing = openRouterPriceEvidence({ data: [
      { id: 'unknown-charge', pricing: { prompt: '0', completion: '0', future_fee: '1' } },
      { id: 'duplicate', pricing: { prompt: '0', completion: '0' } },
      { id: 'duplicate', pricing: { prompt: '1', completion: '1' } },
    ] }, NOW)
    expect(nexusPriceClass({ price: listing.get('unknown-charge') }, NOW)).toBe('unknown')
    expect(nexusPriceClass({ price: listing.get('duplicate') }, NOW)).toBe('unknown')
    const { contextWindow: _context, ...unknownContext } = free
    expect(chooseNexusRoute([unknownContext], { inputTokens: 8192 }, NOW)).toBeUndefined()
  })
})
