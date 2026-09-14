/** Superpower catalog: domain presets are honest about what Phoenix can invoke. */

import { describe, expect, it } from 'vitest'
import {
  SUPERPOWER_CATALOG,
  SUPERPOWER_PRESETS,
  canInvokeSuperpower,
  getSuperpowerPreset,
} from '../src/client/superpowers-catalog.ts'

describe('superpower catalog', () => {
  it('ships the requested high-value presets', () => {
    expect(SUPERPOWER_PRESETS.map(preset => preset.id)).toEqual(expect.arrayContaining([
      'default',
      'development',
      'security',
      'data-analytics',
      'documents',
      'presentations',
      'meetings',
      'cloud-data',
      'finance',
    ]))
  })

  it('catalogs Devpost and the requested ecosystem without pretending pending adapters are connected', () => {
    const byId = new Map(SUPERPOWER_CATALOG.map(item => [item.id, item]))
    for (const id of ['devpost', 'firebase', 'microsoft-teams', 'zoom', 'github', 'binance']) {
      expect(byId.has(id)).toBe(true)
    }
    expect(byId.get('devpost')?.status).toBe('adapter_pending')
    expect(canInvokeSuperpower(byId.get('devpost')!)).toBe(false)
  })

  it('only reports native or explicitly available capabilities as immediately invokable', () => {
    for (const item of SUPERPOWER_CATALOG) {
      expect(canInvokeSuperpower(item)).toBe(item.status === 'native' || item.status === 'available')
    }
  })

  it('resolves every preset to known catalog entries', () => {
    const known = new Set(SUPERPOWER_CATALOG.map(item => item.id))
    for (const preset of SUPERPOWER_PRESETS) {
      expect(preset.capabilities.length).toBeGreaterThan(0)
      expect(preset.capabilities.every(id => known.has(id))).toBe(true)
      expect(getSuperpowerPreset(preset.id)?.id).toBe(preset.id)
    }
  })
})
