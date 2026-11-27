import { describe, expect, it } from 'vitest'
import { parseWindowsLocation, parseCivicCatalog, resolveCivicLocation } from '../src/windows-location.ts'

describe('Windows position and offline locality', () => {
  const now = 1_800_000_000_000
  const raw = { permission: 'Granted', latitude: 10, longitude: 20, accuracyMeters: 20, observedAt: now - 1000 }
  it('requires OS permission, finite coordinates, accuracy and fresh sensor time', () => {
    expect(parseWindowsLocation(raw, now)).toMatchObject({ latitude: 10, observedAt: now - 1000, expiresAt: now + 89_000 })
    for (const invalid of [
      { ...raw, permission: 'Denied' }, { ...raw, latitude: 91 },
      { ...raw, accuracyMeters: 0 }, { ...raw, observedAt: now - 90_000 },
      { ...raw, observedAt: now + 10_000 },
    ]) expect(parseWindowsLocation(invalid, now)).toBeUndefined()
  })
  it('resolves only locally supplied areas containing the full uncertainty radius', () => {
    const catalog = parseCivicCatalog([
      { latitude: 10, longitude: 20, radiusMeters: 5000, country: 'Example', city: 'City' },
      { latitude: 10, longitude: 20, radiusMeters: 100, country: 'Example', city: 'City', sector: 'District' },
    ])
    expect(resolveCivicLocation(catalog, 10, 20, 20)).toMatchObject({ city: 'City', sector: 'District', precision: 'approximate-area' })
    expect(resolveCivicLocation(catalog, 10, 20, 200)).toMatchObject({ city: 'City', sector: null })
    expect(resolveCivicLocation(catalog, 10, 20, null)).toBeUndefined()
    expect(resolveCivicLocation(catalog, 0, 0, 20)).toBeUndefined()
  })
  it('does not guess when countries or cities conflict', () => {
    const base = { latitude: 10, longitude: 20, radiusMeters: 5000, country: 'A' }
    const catalog = parseCivicCatalog([{ ...base, city: 'X' }, { ...base, city: 'Y' }])
    expect(resolveCivicLocation(catalog, 10, 20, 20)).toMatchObject({ country: 'A', city: null })
    expect(resolveCivicLocation([...catalog, { ...base, country: 'B' }], 10, 20, 20)).toBeUndefined()
  })
})
